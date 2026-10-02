from __future__ import annotations

import tempfile
import unittest
import json
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

import backend.backtesting.replay as replay_module
from backend.backtesting.calibration import build_score_bands
from backend.backtesting.costs import apply_adverse_slippage, equity_costs
from backend.backtesting.data_adapters import (
    candle_completion_time,
    completed_candles,
    load_csv,
    parse_timestamp,
)
from backend.backtesting.execution import execute_signal
from backend.backtesting.metrics import summarize_trades
from backend.backtesting.replay import cumulative_session_volume, previous_session_close, run_backtest, run_backtest_from_csv
from backend.backtesting.schemas import BacktestConfig, CostConfig, ExecutionPolicy, NormalizedCandle, SignalRecord, to_jsonable
from backend.paper_engine.pricing import charges
from backend.scanner_engine.indicators import build_context

IST = ZoneInfo("Asia/Kolkata")
SYMBOL = "NSE:TEST-EQ"


class BacktestingCsvAdapterTests(unittest.TestCase):
    def test_csv_normalization_validation_and_rejection_reasons(self) -> None:
        rows = [
            [SYMBOL, "5", int(_dt(2026, 9, 2, 9, 15).timestamp()), 100, 101, 99, 100.5, 1000],
            [SYMBOL, "5", "2026-09-02T09:20:00+05:30", 100.5, 101.5, 100, 101, 1000],
            [SYMBOL, "5", "2026-09-02T09:25:00+05:30", 100, 99, 98, 98.5, 1000],
            [SYMBOL, "5", "2026-09-02T09:30:00+05:30", 100, 101, 99, 100, -1],
            [SYMBOL, "5", "not-a-time", 100, 101, 99, 100, 1000],
            [SYMBOL, "5", "2026-09-05T09:15:00+05:30", 100, 101, 99, 100, 1000],
        ]

        candles, report = load_csv(_write_csv(rows))

        self.assertEqual(len(candles), 2)
        self.assertEqual(report.accepted, 2)
        self.assertEqual(report.rejected, 4)
        self.assertTrue(report.dataset_fingerprint)
        reasons = " ".join(item.reason for item in report.rejections)
        self.assertIn("high is below", reasons)
        self.assertIn("negative price or volume", reasons)
        self.assertIn("timestamp must be epoch seconds or ISO-8601", reasons)
        self.assertIn("outside NSE session", reasons)
        self.assertTrue(all(candle.timestamp.tzinfo is not None for candle in candles))

    def test_sorting_and_deduplication_are_deterministic(self) -> None:
        rows = [
            [SYMBOL, "5", "2026-09-02T09:20:00+05:30", 100, 101, 99, 100.5, 1000],
            [SYMBOL, "5", "2026-09-02T09:15:00+05:30", 99, 100, 98, 99.5, 1000],
            [SYMBOL, "5", "2026-09-02T09:20:00+05:30", 100, 102, 99, 101.5, 1200],
        ]

        candles, report = load_csv(_write_csv(rows))

        self.assertEqual(report.duplicate_count, 1)
        self.assertEqual([candle.close for candle in candles], [99.5, 101.5])

    def test_timestamp_parsing_ist_session_and_incomplete_candle_exclusion(self) -> None:
        epoch = int(_dt(2026, 9, 2, 9, 15).timestamp())
        parsed = parse_timestamp(str(epoch))
        candle = _candle(_dt(2026, 9, 2, 9, 15), close=100)
        future = _candle(_dt(2026, 9, 2, 9, 20), close=101)

        self.assertEqual(parsed.tzinfo, IST)
        self.assertEqual(candle_completion_time(candle), _dt(2026, 9, 2, 9, 20))
        self.assertEqual(completed_candles([candle, future], _dt(2026, 9, 2, 9, 19, 59)), [])
        self.assertEqual(completed_candles([candle, future], _dt(2026, 9, 2, 9, 20)), [candle])


class BacktestingReplayTests(unittest.TestCase):
    def test_golden_breakout_fixture_produces_one_completed_trade(self) -> None:
        result = run_backtest_from_csv(
            "backend/tests/fixtures/backtesting/golden_breakout_equity_ohlcv.csv",
            BacktestConfig(
                strategy="BREAKOUT",
                symbols=["NSE:GOLDEN-EQ"],
                resolution="5",
                start=_dt(2026, 9, 2, 9, 15),
                end=_dt(2026, 9, 2, 9, 45),
                score_threshold=25,
                execution=ExecutionPolicy(fixed_quantity=10, slippage_bps=0, max_holding_bars=3),
            ),
        )

        self.assertEqual(result.metrics.trade_count, 1)
        trade = result.trades[0]
        self.assertEqual(trade.signal_time, _dt(2026, 9, 2, 9, 40))
        self.assertEqual(trade.entry_time, _dt(2026, 9, 2, 9, 40))
        self.assertEqual(trade.exit_reason, "TARGET")
        self.assertGreater(trade.net_pnl, 0)
        self.assertEqual(sum(band.observations for band in result.calibration_bands), 1)
        json.dumps(to_jsonable(result), allow_nan=False)

    def test_scoring_receives_only_completed_candles_before_entry(self) -> None:
        scored_timestamps: list[list[str]] = []
        original_score_context = replay_module.score_context

        def score_spy(ctx, penalty, side):
            scored_timestamps.append(list(ctx["_visible_candle_timestamps"]))
            return original_score_context(ctx, penalty, side)

        with patch("backend.backtesting.replay.score_context", side_effect=score_spy):
            result = run_backtest(
                _volume_spike_candles("BUY"),
                BacktestConfig(
                    strategy="VOLUME_SPIKE",
                    symbols=[SYMBOL],
                    resolution="5",
                    start=_dt(2026, 9, 2, 9, 25),
                    end=_dt(2026, 9, 2, 9, 45),
                    score_threshold=25,
                    strategy_params={"minVolume": 2500},
                    execution=ExecutionPolicy(fixed_quantity=10, slippage_bps=0, max_holding_bars=3),
                ),
            )

        self.assertGreaterEqual(len(scored_timestamps), 1)
        first_trade = result.trades[0]
        visible = scored_timestamps[0]
        self.assertEqual(visible[-1], _dt(2026, 9, 2, 9, 25).isoformat())
        self.assertNotIn(first_trade.entry_time.isoformat(), visible)
        self.assertEqual(first_trade.signal_time, _dt(2026, 9, 2, 9, 30))
        self.assertEqual(first_trade.entry_time, _dt(2026, 9, 2, 9, 30))

    def test_replay_preserves_warmup_history_and_enters_next_candle(self) -> None:
        candles = _volume_spike_candles("BUY")
        config = BacktestConfig(
            strategy="VOLUME_SPIKE",
            symbols=[SYMBOL],
            resolution="5",
            start=_dt(2026, 9, 2, 9, 30),
            end=_dt(2026, 9, 2, 10, 10),
            score_threshold=25,
            strategy_params={"minVolume": 2500},
            execution=ExecutionPolicy(fixed_quantity=10, slippage_bps=0, max_holding_bars=4),
        )

        result = run_backtest(candles, config)

        self.assertGreaterEqual(len(result.signals), 1)
        self.assertGreaterEqual(len(result.trades), 1)
        first = result.trades[0]
        self.assertGreaterEqual(first.entry_time, first.signal_time)
        self.assertEqual(first.entry_time, _dt(2026, 9, 2, 9, 30))
        self.assertNotIn("fewer than 50", " ".join(result.metadata.unsupported_data_reasons))

    def test_replay_is_deterministic_for_identical_inputs(self) -> None:
        config = BacktestConfig(
            strategy="VOLUME_SPIKE",
            symbols=[SYMBOL],
            resolution="5",
            score_threshold=25,
            strategy_params={"minVolume": 2500},
            execution=ExecutionPolicy(fixed_quantity=10, slippage_bps=0, max_holding_bars=3),
        )

        first = run_backtest(_volume_spike_candles("BUY"), config)
        second = run_backtest(_volume_spike_candles("BUY"), config)

        self.assertEqual(first.metadata.run_id, second.metadata.run_id)
        self.assertEqual(first.metadata.dataset_fingerprint, second.metadata.dataset_fingerprint)
        self.assertEqual([(t.entry_time, t.exit_time, t.net_pnl) for t in first.trades], [(t.entry_time, t.exit_time, t.net_pnl) for t in second.trades])
        changed_candles = [*_volume_spike_candles("BUY")]
        changed_candles[-1] = replace(changed_candles[-1], close=changed_candles[-1].close + 1)
        changed_config = replace(config, score_threshold=30)
        self.assertNotEqual(first.metadata.dataset_fingerprint, run_backtest(changed_candles, config).metadata.dataset_fingerprint)
        self.assertNotEqual(first.metadata.run_id, run_backtest(_volume_spike_candles("BUY"), changed_config).metadata.run_id)

    def test_strategy_specific_inputs_are_reconstructed_from_ohlcv(self) -> None:
        cases = {
            "VOLUME_SPIKE": (_volume_spike_candles("BUY"), {"minVolume": 2500}),
            "BREAKOUT": (_breakout_candles(), {}),
            "BREAKOUT_VOLUME": (_breakout_candles(), {}),
            "EMA_CROSS": (_ema_cross_candles(), {}),
            "VWAP_BREAKOUT": (_breakout_candles(), {}),
        }

        for strategy, (candles, params) in cases.items():
            with self.subTest(strategy=strategy):
                config = BacktestConfig(
                    strategy=strategy,  # type: ignore[arg-type]
                    symbols=[SYMBOL],
                    resolution="5",
                    score_threshold=25,
                    strategy_params=params,
                    execution=ExecutionPolicy(fixed_quantity=1, slippage_bps=0, max_holding_bars=2),
                )
                result = run_backtest(candles, config)
                self.assertGreaterEqual(len(result.signals), 1)
                self.assertEqual(result.metadata.unsupported_data_reasons, [])
                trade = result.trades[0]
                self.assertEqual(result.signals[0].side, "BUY")
                self.assertGreaterEqual(result.signals[0].score, 25)
                self.assertLessEqual(result.signals[0].score, 95)
                self.assertGreaterEqual(trade.entry_time, trade.signal_time)
                self.assertIn(trade.exit_reason, {"STOP", "TARGET", "SESSION_END", "MAX_HOLDING"})

    def test_volume_spike_uses_cumulative_session_volume_and_previous_close(self) -> None:
        candles = _volume_spike_candles("SELL")
        config = BacktestConfig(
            strategy="VOLUME_SPIKE",
            symbols=[SYMBOL],
            resolution="5",
            score_threshold=25,
            strategy_params={"minVolume": 2500},
            execution=ExecutionPolicy(fixed_quantity=5, slippage_bps=0, max_holding_bars=3),
        )

        result = run_backtest(candles, config)

        self.assertGreaterEqual(len(result.signals), 1)
        self.assertEqual(result.signals[0].side, "SELL")
        visible = [candle for candle in candles if candle.timestamp <= _dt(2026, 9, 2, 9, 25)]
        self.assertGreater(cumulative_session_volume(visible), 2500)
        self.assertLess(visible[-1].volume, 2500)
        self.assertEqual(previous_session_close(visible), candles[54].close)

    def test_session_vwap_resets_at_nse_session_boundary(self) -> None:
        candles = _previous_session(close=200, count=50)
        candles.extend([
            _candle(_dt(2026, 9, 2, 9, 15), open_price=99, high=101, low=98, close=100, volume=1),
            _candle(_dt(2026, 9, 2, 9, 20), open_price=109, high=111, low=108, close=110, volume=1),
        ])
        now = int(_dt(2026, 9, 2, 9, 25).timestamp())
        quote = {"n": SYMBOL, "v": {"lp": 110, "prev_close_price": 200, "volume": 2}}

        ctx = build_context(quote, {"s": "ok", "candles": [c.scanner_row() for c in candles]}, resolution="5", now=now)

        self.assertIsNotNone(ctx)
        assert ctx is not None
        self.assertAlmostEqual(ctx["vwap"], 105.0)

    def test_production_vwap_resets_for_intraday_resolutions_and_ema_spans_sessions(self) -> None:
        for resolution, minutes in (("5", 5), ("15", 15), ("60", 60)):
            with self.subTest(resolution=resolution):
                raw = _raw_two_session_candles(resolution, minutes)
                now = int((_dt(2026, 9, 2, 9, 15) + timedelta(minutes=minutes * 2)).timestamp())
                quote = {"n": SYMBOL, "v": {"lp": 110, "prev_close_price": 200, "volume": 2}}
                ctx = build_context(quote, {"s": "ok", "candles": raw}, resolution=resolution, now=now)

                self.assertIsNotNone(ctx)
                assert ctx is not None
                self.assertAlmostEqual(ctx["vwap"], 105.0)
                self.assertNotEqual(round(ctx["ema50"], 2), 105.0)

    def test_multiple_symbols_are_isolated_and_results_are_chronological(self) -> None:
        first_symbol = "NSE:AAA-EQ"
        second_symbol = "NSE:BBB-EQ"
        candles = _volume_spike_candles("BUY", symbol=second_symbol)
        candles.extend(_volume_spike_candles("BUY", symbol=first_symbol, current_start=_dt(2026, 9, 2, 9, 20)))
        candles.extend([replace(candle, resolution="15", close=999, high=1000, low=998) for candle in _volume_spike_candles("BUY", symbol=first_symbol)])

        result = run_backtest(
            candles,
            BacktestConfig(
                strategy="VOLUME_SPIKE",
                symbols=[second_symbol, first_symbol],
                resolution="5",
                score_threshold=25,
                strategy_params={"minVolume": 2500},
                execution=ExecutionPolicy(fixed_quantity=5, slippage_bps=0, max_holding_bars=2),
            ),
        )

        self.assertGreaterEqual(result.metrics.trade_count, 2)
        self.assertEqual([trade.exit_time for trade in result.trades], sorted(trade.exit_time for trade in result.trades))
        self.assertEqual([point.timestamp for point in result.equity_curve], sorted(point.timestamp for point in result.equity_curve))
        self.assertTrue(all(trade.symbol in {first_symbol, second_symbol} for trade in result.trades))
        self.assertTrue(all(trade.entry_price < 999 for trade in result.trades))

    def test_default_position_policy_skips_overlapping_same_symbol_signals(self) -> None:
        config = BacktestConfig(
            strategy="VOLUME_SPIKE",
            symbols=[SYMBOL],
            resolution="5",
            score_threshold=25,
            strategy_params={"minVolume": 2500},
            execution=ExecutionPolicy(fixed_quantity=1, slippage_bps=0, max_holding_bars=8),
        )
        default_result = run_backtest(_volume_spike_candles("BUY"), config)
        overlapping_result = run_backtest(_volume_spike_candles("BUY"), replace(config, execution=replace(config.execution, allow_overlapping_positions=True)))

        self.assertGreater(default_result.metadata.skipped_signal_count, 0)
        self.assertLess(default_result.metrics.trade_count, overlapping_result.metrics.trade_count)
        for previous, current in zip(default_result.trades, default_result.trades[1:]):
            self.assertGreater(current.signal_time, previous.exit_time)

    def test_unsupported_data_combination_fails_clearly(self) -> None:
        result = run_backtest(
            _previous_session(close=100, count=49),
            BacktestConfig(strategy="VWAP_BREAKOUT", symbols=[SYMBOL], resolution="5"),
        )

        self.assertEqual(result.trades, [])
        self.assertTrue(any("fewer than 50" in reason or "previous completed session" in reason for reason in result.metadata.unsupported_data_reasons))

    def test_signal_on_final_candle_cannot_create_impossible_entry(self) -> None:
        result = run_backtest(
            _volume_spike_candles("BUY")[:58],
            BacktestConfig(
                strategy="VOLUME_SPIKE",
                symbols=[SYMBOL],
                resolution="5",
                start=_dt(2026, 9, 2, 9, 25),
                score_threshold=25,
                strategy_params={"minVolume": 2500},
            ),
        )

        self.assertEqual(result.trades, [])
        self.assertTrue(any("no next executable candle" in warning for warning in result.metadata.warnings))


class BacktestingExecutionAndMetricsTests(unittest.TestCase):
    def test_buy_sell_gap_tie_session_and_max_holding_execution(self) -> None:
        buy_target = execute_signal(
            "run",
            _signal(side="BUY", sl=98, t1=103),
            [_candle(_dt(2026, 9, 2, 9, 30), close=100), _candle(_dt(2026, 9, 2, 9, 35), open_price=104, high=105, low=103, close=104)],
            ExecutionPolicy(fixed_quantity=10, slippage_bps=0, max_holding_bars=3),
            CostConfig(),
        ).trade
        sell_target = execute_signal(
            "run",
            _signal(side="SELL", sl=103, t1=97),
            [_candle(_dt(2026, 9, 2, 9, 30), close=100), _candle(_dt(2026, 9, 2, 9, 35), open_price=96, high=97, low=95, close=96)],
            ExecutionPolicy(fixed_quantity=10, slippage_bps=0, max_holding_bars=3),
            CostConfig(),
        ).trade
        gap_stop = execute_signal(
            "run",
            _signal(side="BUY", sl=98, t1=103),
            [_candle(_dt(2026, 9, 2, 9, 30), close=100), _candle(_dt(2026, 9, 2, 9, 35), open_price=96, high=97, low=95, close=96)],
            ExecutionPolicy(fixed_quantity=10, slippage_bps=0, max_holding_bars=3),
            CostConfig(),
        ).trade
        tie_stop = execute_signal(
            "run",
            _signal(side="BUY", sl=98, t1=103),
            [_candle(_dt(2026, 9, 2, 9, 30), close=100), _candle(_dt(2026, 9, 2, 9, 35), high=104, low=97, close=101)],
            ExecutionPolicy(fixed_quantity=10, slippage_bps=0, max_holding_bars=3),
            CostConfig(),
        ).trade
        max_exit = execute_signal(
            "run",
            _signal(side="BUY", sl=90, t1=120),
            [_candle(_dt(2026, 9, 2, 9, 30), close=100), _candle(_dt(2026, 9, 2, 9, 35), close=101), _candle(_dt(2026, 9, 2, 9, 40), close=102)],
            ExecutionPolicy(fixed_quantity=10, slippage_bps=0, max_holding_bars=2),
            CostConfig(),
        ).trade
        session_exit = execute_signal(
            "run",
            _signal(side="BUY", sl=90, t1=120),
            [_candle(_dt(2026, 9, 2, 15, 20), close=100), _candle(_dt(2026, 9, 2, 15, 25), close=101), _candle(_dt(2026, 9, 3, 9, 15), close=102)],
            ExecutionPolicy(fixed_quantity=10, slippage_bps=0, max_holding_bars=10),
            CostConfig(),
        ).trade

        assert buy_target and sell_target and gap_stop and tie_stop and max_exit and session_exit
        self.assertEqual(buy_target.exit_reason, "TARGET")
        self.assertEqual(buy_target.exit_price, 103)
        self.assertGreater(buy_target.gross_pnl, 0)
        self.assertEqual(sell_target.exit_reason, "TARGET")
        self.assertGreater(sell_target.gross_pnl, 0)
        self.assertEqual(gap_stop.exit_price, 96)
        self.assertEqual(gap_stop.exit_reason, "STOP")
        self.assertEqual(tie_stop.exit_reason, "STOP")
        self.assertEqual(max_exit.exit_reason, "MAX_HOLDING")
        self.assertEqual(session_exit.exit_reason, "SESSION_END")

    def test_slippage_charges_pnl_returns_mae_mfe_and_r_are_calculated_once(self) -> None:
        trade = execute_signal(
            "run",
            _signal(side="BUY", sl=98, t1=103),
            [_candle(_dt(2026, 9, 2, 9, 30), close=100), _candle(_dt(2026, 9, 2, 9, 35), high=104, low=99, close=103)],
            ExecutionPolicy(fixed_quantity=10, slippage_bps=10, max_holding_bars=3),
            CostConfig(),
        ).trade

        assert trade is not None
        self.assertEqual(trade.entry_price, apply_adverse_slippage(100, "BUY", 10, "ENTRY"))
        self.assertEqual(trade.exit_price, apply_adverse_slippage(103, "BUY", 10, "EXIT"))
        self.assertEqual(trade.entry_charges, charges(trade.entry_price, 10, "BUY"))
        self.assertEqual(trade.exit_charges, charges(trade.exit_price, 10, "SELL"))
        self.assertEqual(trade.total_charges, equity_costs(trade.entry_price, trade.exit_price, 10, "BUY", CostConfig()).total_charges)
        self.assertAlmostEqual(trade.gross_return_pct or 0, (trade.gross_pnl / trade.entry_notional) * 100, places=4)
        self.assertAlmostEqual(trade.net_return_pct or 0, (trade.net_pnl / trade.entry_notional) * 100, places=4)
        self.assertLessEqual(trade.mae, 0)
        self.assertGreater(trade.mfe, 0)
        self.assertIsNotNone(trade.r_multiple)

    def test_metrics_equity_curve_drawdown_losing_streak_and_zero_denominators(self) -> None:
        win = execute_signal(
            "run",
            _signal(side="BUY", sl=98, t1=103),
            [_candle(_dt(2026, 9, 2, 9, 30), close=100), _candle(_dt(2026, 9, 2, 9, 35), high=104, low=99, close=103)],
            ExecutionPolicy(fixed_quantity=10, slippage_bps=0, max_holding_bars=3),
            CostConfig(),
        ).trade
        loss1 = replace(win, exit_time=_dt(2026, 9, 2, 9, 40), gross_pnl=-10, net_pnl=-10)  # type: ignore[arg-type]
        loss2 = replace(win, exit_time=_dt(2026, 9, 2, 9, 45), gross_pnl=-5, net_pnl=-5)  # type: ignore[arg-type]
        assert win is not None

        summary, curve = summarize_trades([win, loss1, loss2])
        empty_summary, empty_curve = summarize_trades([])

        self.assertEqual(summary.trade_count, 3)
        self.assertEqual(summary.longest_losing_streak, 2)
        self.assertEqual(summary.profit_factor_basis, "net_pnl")
        self.assertLess(summary.max_drawdown, 0)
        self.assertEqual(len(curve), 3)
        self.assertIsNone(empty_summary.gross_return_pct)
        self.assertIsNone(empty_summary.win_rate)
        self.assertEqual(empty_curve, [])

    def test_malformed_executable_candle_cannot_create_trade(self) -> None:
        result = execute_signal(
            "run",
            _signal(side="BUY", sl=98, t1=103),
            [NormalizedCandle(symbol=SYMBOL, resolution="5", timestamp=_dt(2026, 9, 2, 9, 30), open=100, high=99, low=98, close=100, volume=1000)],
            ExecutionPolicy(),
            CostConfig(),
        )

        self.assertIsNone(result.trade)
        self.assertIn("Malformed executable candle", result.warning or "")

    def test_score_band_aggregation_empty_and_insufficient_samples(self) -> None:
        trade = execute_signal(
            "run",
            _signal(side="BUY", sl=98, t1=103, score=75),
            [_candle(_dt(2026, 9, 2, 9, 30), close=100), _candle(_dt(2026, 9, 2, 9, 35), high=104, low=99, close=103)],
            ExecutionPolicy(fixed_quantity=10, slippage_bps=0, max_holding_bars=3),
            CostConfig(),
        ).trade
        assert trade is not None

        bands = build_score_bands([trade], min_observations=2)
        active = next(band for band in bands if band.band == "70-79")
        empty = next(band for band in bands if band.band == "25-49")

        self.assertEqual(active.observations, 1)
        self.assertIsNotNone(active.warning)
        self.assertEqual(active.win_rate, 1.0)
        self.assertEqual(empty.observations, 0)
        self.assertIsNone(empty.win_rate)
        self.assertIsNotNone(empty.warning)

    def test_backtesting_package_does_not_reference_fyers_mutation_methods(self) -> None:
        forbidden = ("place_order", "modify_order", "cancel_order", "exit_position", "squareoff_all")
        source = "\n".join(path.read_text(encoding="utf-8") for path in Path("backend/backtesting").glob("*.py"))

        for token in forbidden:
            self.assertNotIn(token, source)

        offline_modules = ("replay.py", "execution.py", "metrics.py", "calibration.py", "data_adapters.py", "costs.py")
        offline_source = "\n".join((Path("backend/backtesting") / name).read_text(encoding="utf-8") for name in offline_modules)
        self.assertNotIn("fyers", offline_source.lower())


def _write_csv(rows: list[list[object]]) -> str:
    handle = tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="", delete=False, suffix=".csv")
    with handle:
        handle.write("symbol,resolution,timestamp,open,high,low,close,volume\n")
        for row in rows:
            handle.write(",".join(str(item) for item in row) + "\n")
    return handle.name


def _dt(year: int, month: int, day: int, hour: int, minute: int, second: int = 0) -> datetime:
    return datetime(year, month, day, hour, minute, second, tzinfo=IST)


def _candle(
    timestamp: datetime,
    close: float,
    open_price: float | None = None,
    high: float | None = None,
    low: float | None = None,
    volume: float = 1000,
    symbol: str = SYMBOL,
    resolution: str = "5",
) -> NormalizedCandle:
    open_value = close if open_price is None else open_price
    high_value = max(open_value, close) + 0.5 if high is None else high
    low_value = min(open_value, close) - 0.5 if low is None else low
    return NormalizedCandle(symbol=symbol, resolution=resolution, timestamp=timestamp, open=open_value, high=high_value, low=low_value, close=close, volume=volume)


def _previous_session(close: float, count: int = 55, symbol: str = SYMBOL) -> list[NormalizedCandle]:
    start = _dt(2026, 9, 1, 9, 15)
    return [_candle(start + timedelta(minutes=5 * index), close=close + (index * 0.01), volume=1000, symbol=symbol) for index in range(count)]


def _volume_spike_candles(side: str, symbol: str = SYMBOL, current_start: datetime | None = None) -> list[NormalizedCandle]:
    candles = _previous_session(close=110, count=55, symbol=symbol)
    start = current_start or _dt(2026, 9, 2, 9, 15)
    for index in range(12):
        close = 112 + index * 0.4 if side == "BUY" else 104 - index * 0.4
        open_price = close - 0.2 if side == "BUY" else close + 0.2
        candles.append(_candle(start + timedelta(minutes=5 * index), close=close, open_price=open_price, high=max(open_price, close) + 0.5, low=min(open_price, close) - 0.5, volume=1000, symbol=symbol))
    return candles


def _breakout_candles() -> list[NormalizedCandle]:
    candles = _previous_session(close=100, count=55)
    start = _dt(2026, 9, 2, 9, 15)
    for index in range(12):
        if index < 4:
            close = 100 + index * 0.2
            volume = 1000
        else:
            close = 108 + index * 0.5
            volume = 8000
        candles.append(_candle(start + timedelta(minutes=5 * index), close=close, open_price=close - 1.0, high=close + 0.2, low=close - 1.4, volume=volume))
    return candles


def _ema_cross_candles() -> list[NormalizedCandle]:
    candles = _previous_session(close=95, count=55)
    start = _dt(2026, 9, 2, 9, 15)
    for index in range(25):
        close = 100 + index * 0.8
        candles.append(_candle(start + timedelta(minutes=5 * index), close=close, open_price=close - 0.4, high=close + 0.4, low=close - 0.8, volume=2500))
    return candles


def _raw_two_session_candles(resolution: str, minutes: int) -> list[list[float]]:
    rows: list[list[float]] = []
    day = datetime(2026, 6, 15, 9, 15, tzinfo=IST)
    while len(rows) < 50:
        if day.weekday() < 5:
            rows.append([float(int(day.timestamp())), 200, 200.5, 199.5, 200, 1000])
        day += timedelta(days=1)
    current_start = _dt(2026, 9, 2, 9, 15)
    rows.append([float(int(current_start.timestamp())), 99, 101, 98, 100, 1])
    second = current_start + timedelta(minutes=minutes)
    rows.append([float(int(second.timestamp())), 109, 111, 108, 110, 1])
    return rows


def _signal(side: str, sl: float, t1: float, score: float = 75) -> SignalRecord:
    return SignalRecord(
        symbol=SYMBOL,
        strategy="TEST",
        side=side,  # type: ignore[arg-type]
        decision_time=_dt(2026, 9, 2, 9, 25),
        entry_time=_dt(2026, 9, 2, 9, 30),
        signal="Unit test",
        score=score,
        score_type="rule_based_confluence",
        calibrated=False,
        score_range=[25, 95],
        entry=100,
        sl=sl,
        t1=t1,
        t2=t1,
        factors={},
        breakdown=[],
    )


if __name__ == "__main__":
    unittest.main()
