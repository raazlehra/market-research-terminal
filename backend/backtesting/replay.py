from __future__ import annotations

import hashlib
import json
import uuid
from collections import defaultdict
from dataclasses import asdict, replace
from datetime import datetime, timezone
from typing import Any, cast

from backend.scanner_engine.engine import _signal_side
from backend.scanner_engine.indicators import build_context
from backend.scanner_engine.scoring import score_context
from backend.scanner_engine.signals import detect_signal

from .calibration import build_score_bands
from .data_adapters import candle_completion_time, completed_candles, load_csv
from .execution import execute_signal
from .metrics import summarize_trades
from .schemas import (
    CODE_VERSION,
    SCHEMA_VERSION,
    BacktestConfig,
    BacktestResult,
    NormalizedCandle,
    RunMetadata,
    SignalRecord,
    TradeSide,
)

SUPPORTED_STRATEGIES = {
    "VOLUME_SPIKE": "Requires cumulative session volume and previous completed session close; both are reconstructed from OHLCV when available.",
    "BREAKOUT_VOLUME": "Supported from OHLCV using previous 20-bar high, current completed candle volume, VWAP and EMAs.",
    "BREAKOUT": "Supported from OHLCV using previous 20-bar high, current completed candle volume, VWAP and EMAs.",
    "EMA_CROSS": "Supported from OHLCV after EMA warm-up.",
    "VWAP_BREAKOUT": "Supported from OHLCV after session VWAP and volume warm-up.",
}


def run_backtest_from_csv(csv_path: str, config: BacktestConfig) -> BacktestResult:
    candles, report = load_csv(csv_path)
    return run_backtest(candles, config, report.dataset_fingerprint, report)


def run_backtest(
    candles: list[NormalizedCandle],
    config: BacktestConfig,
    dataset_fingerprint: str | None = None,
    load_report=None,
) -> BacktestResult:
    run_id = config.run_id or _stable_run_id(candles, config)
    warnings: list[str] = []
    unsupported: list[str] = []
    filtered = _filter_candles(candles, config)
    grouped: dict[str, list[NormalizedCandle]] = defaultdict(list)
    for candle in filtered:
        if candle.symbol in config.symbols and candle.resolution == config.resolution:
            grouped[candle.symbol].append(candle)
    signals: list[SignalRecord] = []
    trades = []
    skipped_reasons: list[str] = []
    open_until: dict[tuple[str, str], datetime] = {}
    events: list[tuple[datetime, str, int, list[NormalizedCandle]]] = []
    for symbol in sorted(config.symbols):
        rows = grouped.get(symbol, [])
        if not rows:
            unsupported.append(f"{symbol}: no candles for requested symbol/resolution")
            continue
        for index, candle in enumerate(rows):
            decision_at = candle_completion_time(candle)
            if decision_at is None:
                unsupported.append(f"{symbol}: unsupported resolution for candle completion")
                continue
            events.append((decision_at, symbol, index, rows))

    for decision_at, symbol, index, rows in sorted(events, key=lambda item: (item[0], item[1], item[2])):
        if not _decision_in_range(decision_at, config):
            continue
        position_key = (symbol, config.strategy)
        visible = completed_candles(rows[:index + 1], decision_at, symbol=symbol, resolution=config.resolution)
        signal = _signal_at(symbol, config, visible, decision_at)
        if signal is None:
            continue
        if signal.unsupported_reason:
            if index == len(rows) - 1 and signal.unsupported_reason not in unsupported:
                unsupported.append(signal.unsupported_reason)
            continue
        if signal.score < config.score_threshold:
            continue
        entry_candle = _next_entry_candle(rows, index, signal.decision_time, config)
        if entry_candle is None:
            warnings.append(f"{symbol} {signal.decision_time.isoformat()}: no next executable candle for entry")
            continue
        if (
            not config.execution.allow_overlapping_positions
            and position_key in open_until
            and decision_at <= open_until[position_key]
        ):
            skipped_reasons.append(f"{symbol}: skipped signal while {config.strategy} position is open")
            continue
        signal = replace(signal, entry_time=entry_candle.timestamp)
        future = [future_candle for future_candle in rows[index + 1:] if future_candle.timestamp >= entry_candle.timestamp]
        execution = execute_signal(run_id, signal, future, config.execution, config.costs)
        if execution.warning:
            warnings.append(f"{symbol} {signal.decision_time.isoformat()}: {execution.warning}")
            continue
        if execution.trade:
            signals.append(signal)
            trades.append(execution.trade)
            open_until[position_key] = execution.trade.exit_time
    signals.sort(key=lambda item: (item.decision_time, item.symbol))
    trades.sort(key=lambda item: (item.exit_time, item.symbol))
    metrics, curve = summarize_trades(trades)
    metadata = RunMetadata(
        run_id=run_id,
        strategy=config.strategy,
        symbols=config.symbols,
        resolution=config.resolution,
        start=config.start,
        end=config.end,
        execution_policy=asdict(config.execution),
        cost_config=asdict(config.costs),
        score_threshold=config.score_threshold,
        dataset_fingerprint=dataset_fingerprint or _fingerprint_candles(candles),
        run_config=_config_json(config),
        schema_version=SCHEMA_VERSION,
        code_version=CODE_VERSION,
        created_at=datetime.now(timezone.utc),
        warnings=warnings,
        unsupported_data_reasons=unsupported,
        skipped_signal_count=len(skipped_reasons),
        skipped_signal_reasons=sorted(set(skipped_reasons)),
    )
    if load_report is None:
        from .schemas import CsvLoadReport
        load_report = CsvLoadReport(accepted=len(candles), rejected=0, duplicate_count=0, rejections=[], dataset_fingerprint=metadata.dataset_fingerprint)
    return BacktestResult(
        metadata=metadata,
        load_report=load_report,
        signals=signals,
        trades=trades,
        metrics=metrics,
        equity_curve=curve,
        calibration_bands=build_score_bands(trades),
    )


def _signal_at(symbol: str, config: BacktestConfig, visible: list[NormalizedCandle], replay_at: datetime) -> SignalRecord | None:
    unsupported = _unsupported_reason(symbol, config, visible)
    if unsupported:
        return _unsupported_signal(symbol, config, replay_at, unsupported)
    assert visible
    quote = _quote_from_ohlcv(visible)
    history = {"s": "ok", "candles": [candle.scanner_row() for candle in visible]}
    ctx = build_context(quote, history, resolution=config.resolution, now=int(replay_at.timestamp()))
    if not ctx:
        return _unsupported_signal(symbol, config, replay_at, f"{symbol}: insufficient completed candle history for scanner context")
    signal, penalty = detect_signal(config.strategy, config.strategy_params, ctx)
    if not signal:
        return None
    side_value = _signal_side(config.strategy, ctx)
    if side_value not in {"BUY", "SELL"}:
        return _unsupported_signal(symbol, config, replay_at, f"{symbol}: unsupported signal side {side_value}")
    side = cast(TradeSide, side_value)
    ctx["_visible_candle_timestamps"] = [candle.timestamp.isoformat() for candle in visible]
    scored = score_context(ctx, penalty, side)
    entry_time = None
    return SignalRecord(
        symbol=symbol,
        strategy=config.strategy,
        side=side,
        decision_time=replay_at,
        entry_time=entry_time,
        signal=signal,
        score=float(scored.get("confidence", 0)),
        score_type=str(scored.get("scoreType", "")),
        calibrated=bool(scored.get("calibrated", False)),
        score_range=list(scored.get("scoreRange", [])),
        entry=float(scored.get("entry", ctx["ltp"])),
        sl=float(scored["sl"]),
        t1=float(scored["t1"]),
        t2=float(scored["t2"]),
        factors=dict(scored.get("factors", {})),
        breakdown=list(scored.get("breakdown", [])),
    )


def schedule_entries(signals: list[SignalRecord], candles: list[NormalizedCandle]) -> list[SignalRecord]:
    by_symbol: dict[str, list[NormalizedCandle]] = defaultdict(list)
    for candle in candles:
        by_symbol[candle.symbol].append(candle)
    scheduled: list[SignalRecord] = []
    for signal in signals:
        next_candle = next((candle for candle in by_symbol[signal.symbol] if candle.timestamp > signal.decision_time), None)
        scheduled.append(SignalRecord(**{**asdict(signal), "entry_time": next_candle.timestamp if next_candle else None}))
    return scheduled


def _quote_from_ohlcv(visible: list[NormalizedCandle]) -> dict[str, Any]:
    last = visible[-1]
    previous_close = previous_session_close(visible)
    session_volume = cumulative_session_volume(visible)
    chp = ((last.close - previous_close) / previous_close) * 100 if previous_close else 0
    return {
        "n": last.symbol,
        "v": {
            "lp": last.close,
            "prev_close_price": previous_close,
            "volume": session_volume,
            "chp": chp,
        },
    }


def cumulative_session_volume(visible: list[NormalizedCandle]) -> float:
    if not visible:
        return 0.0
    session_date = visible[-1].timestamp.date()
    return sum(candle.volume for candle in visible if candle.timestamp.date() == session_date)


def previous_session_close(visible: list[NormalizedCandle]) -> float | None:
    if not visible:
        return None
    current_date = visible[-1].timestamp.date()
    previous = [candle for candle in visible if candle.timestamp.date() < current_date]
    return previous[-1].close if previous else None


def _unsupported_reason(symbol: str, config: BacktestConfig, visible: list[NormalizedCandle]) -> str | None:
    if config.strategy not in SUPPORTED_STRATEGIES:
        return f"{symbol}: unsupported strategy {config.strategy}"
    if len(visible) < 50:
        return f"{symbol}: fewer than 50 completed candles available"
    if previous_session_close(visible) is None:
        return f"{symbol}: previous completed session close unavailable"
    return None


def _unsupported_signal(symbol: str, config: BacktestConfig, replay_at: datetime, reason: str) -> SignalRecord:
    return SignalRecord(
        symbol=symbol,
        strategy=config.strategy,
        side="BUY",
        decision_time=replay_at,
        entry_time=None,
        signal="UNSUPPORTED",
        score=0,
        score_type="rule_based_confluence",
        calibrated=False,
        score_range=[25, 95],
        entry=0,
        sl=0,
        t1=0,
        t2=0,
        factors={},
        breakdown=[],
        unsupported_reason=reason,
    )


def _filter_candles(candles: list[NormalizedCandle], config: BacktestConfig) -> list[NormalizedCandle]:
    return [
        candle for candle in sorted(candles, key=lambda item: (item.symbol, item.timestamp))
        if config.end is None or candle.timestamp <= config.end
    ]


def _decision_in_range(decision_at: datetime, config: BacktestConfig) -> bool:
    if config.start is not None and decision_at < config.start:
        return False
    if config.end is not None and decision_at > config.end:
        return False
    return True


def _next_entry_candle(
    rows: list[NormalizedCandle],
    decision_index: int,
    decision_at: datetime,
    config: BacktestConfig,
) -> NormalizedCandle | None:
    decision_day = decision_at.astimezone(timezone.utc).astimezone(rows[decision_index].timestamp.tzinfo).date()
    for candle in rows[decision_index + 1:]:
        if candle.timestamp < decision_at:
            continue
        if config.execution.no_overnight and candle.timestamp.date() != decision_day:
            return None
        if config.end is not None and candle.timestamp > config.end:
            return None
        return candle
    return None


def _stable_run_id(candles: list[NormalizedCandle], config: BacktestConfig) -> str:
    digest = hashlib.sha256()
    digest.update(_fingerprint_candles(candles).encode("utf-8"))
    digest.update(json.dumps(_config_json(config), sort_keys=True, default=str).encode("utf-8"))
    return str(uuid.UUID(digest.hexdigest()[:32]))


def _fingerprint_candles(candles: list[NormalizedCandle]) -> str:
    digest = hashlib.sha256()
    for candle in sorted(candles, key=lambda item: (item.symbol, item.resolution, item.timestamp)):
        digest.update(f"{candle.symbol}|{candle.resolution}|{candle.epoch}|{candle.open}|{candle.high}|{candle.low}|{candle.close}|{candle.volume}\n".encode("utf-8"))
    return digest.hexdigest()


def _config_json(config: BacktestConfig) -> dict[str, Any]:
    raw = asdict(config)
    return json.loads(json.dumps(raw, default=str))
