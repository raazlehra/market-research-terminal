from __future__ import annotations

from dataclasses import dataclass
import math

from .costs import apply_adverse_slippage, equity_costs
from .schemas import CostConfig, ExecutionPolicy, ExitReason, NormalizedCandle, SignalRecord, TradeRecord


@dataclass(frozen=True)
class ExecutionResult:
    trade: TradeRecord | None
    warning: str | None = None


def execute_signal(
    run_id: str,
    signal: SignalRecord,
    future_candles: list[NormalizedCandle],
    policy: ExecutionPolicy,
    cost_config: CostConfig,
) -> ExecutionResult:
    if not future_candles:
        return ExecutionResult(None, "No executable candle after signal.")
    malformed = next((candle for candle in future_candles if not _valid_candle(candle)), None)
    if malformed is not None:
        return ExecutionResult(None, f"Malformed executable candle at {malformed.timestamp.isoformat()}.")
    qty = max(1, int(policy.fixed_quantity))
    entry_candle = future_candles[0]
    raw_entry = entry_candle.open
    entry_price = apply_adverse_slippage(raw_entry, signal.side, policy.slippage_bps, "ENTRY")
    max_bars = max(1, int(policy.max_holding_bars))
    holding_window = future_candles[:max_bars]
    exit_candle = holding_window[-1]
    exit_reason: ExitReason = "MAX_HOLDING"
    raw_exit = exit_candle.close

    for index, candle in enumerate(holding_window):
        hit_stop = candle.low <= signal.sl if signal.side == "BUY" else candle.high >= signal.sl
        hit_target = candle.high >= signal.t1 if signal.side == "BUY" else candle.low <= signal.t1
        if hit_stop:
            exit_candle = candle
            if signal.side == "BUY":
                raw_exit = min(signal.sl, candle.open)
            else:
                raw_exit = max(signal.sl, candle.open)
            exit_reason = "STOP"
            holding_window = holding_window[:index + 1]
            break
        if hit_target:
            exit_candle = candle
            raw_exit = signal.t1
            exit_reason = "TARGET"
            holding_window = holding_window[:index + 1]
            break
        if policy.no_overnight and candle.timestamp.date() != entry_candle.timestamp.date():
            previous = holding_window[max(0, index - 1)]
            exit_candle = previous
            raw_exit = previous.close
            exit_reason = "SESSION_END"
            holding_window = holding_window[:index]
            break
    else:
        last_same_session = [candle for candle in holding_window if candle.timestamp.date() == entry_candle.timestamp.date()]
        if policy.no_overnight and last_same_session and len(holding_window) < max_bars:
            exit_candle = last_same_session[-1]
            raw_exit = exit_candle.close
            exit_reason = "SESSION_END"
            holding_window = last_same_session

    exit_price = apply_adverse_slippage(raw_exit, signal.side, policy.slippage_bps, "EXIT")
    direction = 1 if signal.side == "BUY" else -1
    gross_pnl = round((exit_price - entry_price) * qty * direction, 2)
    cost = equity_costs(entry_price, exit_price, qty, signal.side, cost_config)
    net_pnl = round(gross_pnl - cost.total_charges, 2)
    entry_notional = round(abs(entry_price * qty), 2)
    initial_risk_value = abs(entry_price - signal.sl) * qty
    initial_risk = round(initial_risk_value, 2) if initial_risk_value > 0 else None
    r_multiple = round(net_pnl / initial_risk, 4) if initial_risk else None
    gross_return = round((gross_pnl / entry_notional) * 100, 4) if entry_notional > 0 else None
    net_return = round((net_pnl / entry_notional) * 100, 4) if entry_notional > 0 else None
    mae, mfe = _mae_mfe(entry_price, signal.side, holding_window)
    trade = TradeRecord(
        run_id=run_id,
        symbol=signal.symbol,
        strategy=signal.strategy,
        side=signal.side,
        signal_time=signal.decision_time,
        entry_time=entry_candle.timestamp,
        exit_time=exit_candle.timestamp,
        entry_price=entry_price,
        exit_price=exit_price,
        qty=qty,
        exit_reason=exit_reason,
        entry_notional=entry_notional,
        gross_pnl=gross_pnl,
        entry_charges=cost.entry_charges,
        exit_charges=cost.exit_charges,
        total_charges=cost.total_charges,
        net_pnl=net_pnl,
        gross_return_pct=gross_return,
        net_return_pct=net_return,
        initial_risk=initial_risk,
        r_multiple=r_multiple,
        mae=mae,
        mfe=mfe,
        holding_bars=len(holding_window),
        holding_seconds=int(exit_candle.timestamp.timestamp() - entry_candle.timestamp.timestamp()),
        score=signal.score,
        signal=signal.signal,
        score_breakdown=signal.breakdown,
    )
    return ExecutionResult(trade)


def _mae_mfe(entry_price: float, side: str, candles: list[NormalizedCandle]) -> tuple[float, float]:
    if not candles:
        return 0.0, 0.0
    if side == "BUY":
        adverse = min(candle.low - entry_price for candle in candles)
        favorable = max(candle.high - entry_price for candle in candles)
    else:
        adverse = min(entry_price - candle.high for candle in candles)
        favorable = max(entry_price - candle.low for candle in candles)
    return round(adverse, 4), round(favorable, 4)


def _valid_candle(candle: NormalizedCandle) -> bool:
    values = (candle.open, candle.high, candle.low, candle.close, candle.volume)
    if not all(math.isfinite(value) for value in values):
        return False
    if min(candle.open, candle.high, candle.low, candle.close) < 0 or candle.volume < 0:
        return False
    return candle.high >= max(candle.open, candle.close, candle.low) and candle.low <= min(candle.open, candle.close, candle.high)
