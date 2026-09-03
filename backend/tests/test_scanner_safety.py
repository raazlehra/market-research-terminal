import unittest
import json
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend import models, state
from backend.main import app
from backend.routes import scanner_strategy_routes
from backend.routes.scanner_strategy_routes import ScannerRequest
from backend.scanner_engine.engine import ScannerEngine, _prefilter_quotes, _resolution_seconds, _result_row, _signal_side
from backend.scanner_engine.indicators import _completed_candles, build_context
from backend.scanner_engine.scoring import score_context


class ScannerSafetyTests(unittest.TestCase):
    def test_bullish_breakout_is_not_flipped_by_negative_day_change(self) -> None:
        self.assertEqual(_signal_side("VWAP_BREAKOUT", {"chp": -0.5}), "BUY")

    def test_direction_controls_stop_and_targets(self) -> None:
        context = {
            "close": 100,
            "vwap": 99,
            "ema20": 99,
            "ema50": 98,
            "avg_volume": 100,
            "current_volume": 200,
            "chp": -1,
            "day_high": 105,
            "day_low": 95,
            "atr": 2,
        }
        buy = score_context(context, 0, "BUY")
        sell = score_context(context, 0, "SELL")
        self.assertLess(buy["sl"], 100)
        self.assertGreater(buy["t1"], 100)
        self.assertGreater(sell["sl"], 100)
        self.assertLess(sell["t1"], 100)

    def test_bullish_signal_rewards_bullish_trend_alignment(self) -> None:
        scored = score_context(_scanner_context(close=105, vwap=101, ema20=103, ema50=100), 0, "BUY")
        self.assertEqual(scored["intendedSide"], "bullish")
        self.assertEqual(scored["factors"]["trend"], 25)
        self.assertEqual(scored["breakdown"][0]["direction"], "bullish")

    def test_bullish_signal_does_not_reward_bearish_trend_alignment(self) -> None:
        bullish = score_context(_scanner_context(close=105, vwap=101, ema20=103, ema50=100), 0, "BUY")
        bearish = score_context(_scanner_context(close=95, vwap=100, ema20=98, ema50=101), 0, "BUY")
        self.assertLessEqual(bearish["factors"]["trend"], 0)
        self.assertLess(bearish["confidence"], bullish["confidence"])
        self.assertIn("Contradictory bearish alignment", bearish["breakdown"][0]["reason"])

    def test_neutral_trend_alignment_is_explicit(self) -> None:
        scored = score_context(_scanner_context(close=100, vwap=100, ema20=100, ema50=100), 0, "BUY")
        self.assertEqual(scored["factors"]["trend"], 0)
        self.assertEqual(scored["breakdown"][0]["direction"], "neutral")

    def test_unknown_side_marks_trend_as_missing(self) -> None:
        scored = score_context(_scanner_context(), 0, "HOLD")
        self.assertEqual(scored["intendedSide"], "neutral")
        self.assertTrue(scored["breakdown"][0]["missingData"])

    def test_contradictory_sell_signal_does_not_gain_bullish_trend_points(self) -> None:
        scored = score_context(_scanner_context(close=105, vwap=101, ema20=103, ema50=100), 0, "SELL")
        self.assertLessEqual(scored["factors"]["trend"], 0)
        self.assertEqual(scored["breakdown"][0]["direction"], "bullish")

    def test_score_boundaries_are_preserved(self) -> None:
        low = score_context(_scanner_context(close=95, vwap=100, ema20=98, ema50=101, current_volume=0, chp=0), 80, "BUY")
        high = score_context(_scanner_context(current_volume=300, chp=5), 0, "BUY")
        self.assertEqual(low["confidence"], 25)
        self.assertEqual(high["confidence"], 95)
        self.assertEqual(low["scoreRange"], [25, 95])
        self.assertEqual(high["scoreRange"], [25, 95])

    def test_score_breakdown_is_serializable_and_matches_formula(self) -> None:
        scored = score_context(_scanner_context(close=100, vwap=100, ema20=100, ema50=100, current_volume=100, chp=0.6), 0, "BUY")
        json.dumps(scored["breakdown"])
        points = sum(float(item["pointsContributed"]) for item in scored["breakdown"])
        self.assertEqual(scored["scoreType"], "rule_based_confluence")
        self.assertFalse(scored["calibrated"])
        self.assertEqual(scored["confidence"], 30 + points)

    def test_result_row_fallback_metadata_matches_actual_score_range(self) -> None:
        row = _result_row(
            {"symbol": "NSE:TEST-EQ", "close": 100, "chp": 1, "current_volume": 1000},
            "Test Signal",
            "BUY",
            {"confidence": 50, "entry": 100, "sl": 98, "t1": 103, "t2": 105, "factors": {}},
        )
        self.assertEqual(row["scoreRange"], [25, 95])

    def test_scanner_request_rejects_unknown_inputs(self) -> None:
        with self.assertRaises(ValidationError):
            ScannerRequest.model_validate({"type": "UNKNOWN", "params": {"resolution": "1"}})

    def test_quote_prefilter_limits_history_candidates(self) -> None:
        quotes = [
            {"n": f"NSE:TEST{index}-EQ", "v": {"lp": 100 + index, "volume": 10_000 + index, "chp": index / 10}}
            for index in range(100)
        ]
        candidates = _prefilter_quotes("VWAP_BREAKOUT", {}, quotes, limit=40)
        self.assertEqual(len(candidates), 40)
        self.assertGreaterEqual(abs(float(candidates[0]["v"]["chp"])), abs(float(candidates[-1]["v"]["chp"])))

    def test_resolution_cache_bucket(self) -> None:
        self.assertEqual(_resolution_seconds("1"), 60)
        self.assertEqual(_resolution_seconds("5"), 300)
        self.assertEqual(_resolution_seconds("15"), 900)
        self.assertEqual(_resolution_seconds("60"), 3600)
        self.assertEqual(_resolution_seconds("D"), 86400)
        self.assertIsNone(_resolution_seconds("2"))

    def test_incomplete_final_candle_is_excluded(self) -> None:
        candles = _candles(50, start=1_000_000, step=300)
        candles.append([1_015_000, 200, 201, 199, 200, 5000])
        completed = _completed_candles(candles, "5", now=1_015_100)
        self.assertEqual(len(completed), 50)
        self.assertNotEqual(completed[-1][0], 1_015_000)

    def test_completed_final_candle_is_used(self) -> None:
        candles = _candles(50, start=1_000_000, step=300)
        completed = _completed_candles(candles, "5", now=1_015_000)
        self.assertEqual(len(completed), 50)
        self.assertEqual(completed[-1][0], 1_014_700)

    def test_completed_candles_are_ordered_and_deduplicated(self) -> None:
        candles = _candles(50, start=1_000_000, step=300)
        duplicate = [1_000_000, 90, 92, 89, 91, 9000]
        shuffled = [candles[2], candles[1], candles[0], *candles[3:], duplicate]
        completed = _completed_candles(shuffled, "5", now=1_015_000)
        self.assertEqual(len(completed), 50)
        self.assertEqual([row[0] for row in completed], sorted(row[0] for row in completed))
        self.assertEqual(completed[0][4], 91)

    def test_millisecond_timestamps_are_normalized(self) -> None:
        candles = _candles(50, start=1_700_000_000, step=300)
        millis = [[int(row[0] * 1000), *row[1:]] for row in candles]
        completed = _completed_candles(millis, "5", now=1_700_015_000)
        self.assertEqual(len(completed), 50)
        self.assertEqual(completed[-1][0], 1_700_014_700)

    def test_daily_candle_completes_at_ist_market_close(self) -> None:
        ist = ZoneInfo("Asia/Kolkata")
        candle_open = int(datetime(2026, 9, 2, 9, 15, tzinfo=ist).timestamp())
        before_close = int(datetime(2026, 9, 2, 15, 29, 59, tzinfo=ist).timestamp())
        at_close = int(datetime(2026, 9, 2, 15, 30, 0, tzinfo=ist).timestamp())
        candles = [[candle_open, 100, 102, 99, 101, 1000]]
        self.assertEqual(_completed_candles(candles, "D", now=before_close), [])
        self.assertEqual(len(_completed_candles(candles, "D", now=at_close)), 1)

    def test_weekend_daily_candle_is_rejected(self) -> None:
        ist = ZoneInfo("Asia/Kolkata")
        saturday = int(datetime(2026, 9, 5, 9, 15, tzinfo=ist).timestamp())
        self.assertEqual(_completed_candles([[saturday, 100, 102, 99, 101, 1000]], "D", now=saturday + 86400), [])

    def test_unknown_resolution_fails_safely(self) -> None:
        candles = _candles(50, start=1_000_000, step=120)
        self.assertEqual(_completed_candles(candles, "2", now=1_010_000), [])
        quote = {"n": "NSE:TEST-EQ", "v": {"lp": 114.9, "prev_close_price": 100, "volume": 500000}}
        self.assertIsNone(build_context(quote, {"candles": candles}, resolution="2", now=1_010_000))

    def test_build_context_uses_ordered_completed_candles_for_indicators(self) -> None:
        candles = _candles(50, start=1_000_000, step=300)
        incomplete = [1_015_000, 300, 301, 299, 300, 100000]
        quote = {"n": "NSE:TEST-EQ", "v": {"lp": 114.9, "prev_close_price": 100, "volume": 500000}}
        ctx = build_context(quote, {"candles": [*reversed(candles), incomplete]}, resolution="5", now=1_015_100)
        self.assertIsNotNone(ctx)
        assert ctx is not None
        self.assertLess(ctx["close"], 300)
        self.assertGreater(ctx["ema20"], 0)
        self.assertGreater(ctx["ema50"], 0)
        self.assertGreater(ctx["vwap"], 0)

    def test_insufficient_completed_history_fails_safely(self) -> None:
        candles = _candles(49, start=1_000_000, step=300)
        quote = {"n": "NSE:TEST-EQ", "v": {"lp": 114.9, "prev_close_price": 100, "volume": 500000}}
        self.assertIsNone(build_context(quote, {"candles": candles}, resolution="5", now=1_015_000))


class HistoryCacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_history_is_reused_within_completed_candle_bucket(self) -> None:
        class FakeFyers:
            def __init__(self) -> None:
                self.calls = 0

            async def quotes(self, symbols):
                return {"d": []}

            async def history(self, symbol, resolution, frm, to):
                self.calls += 1
                return {"s": "ok", "candles": [[to, 1, 1, 1, 1, 1]]}

        fyers = FakeFyers()
        engine = ScannerEngine(fyers)
        first = await engine._fetch_history("NSE:TEST-EQ", "5", 1_000_000)
        second = await engine._fetch_history("NSE:TEST-EQ", "5", 1_000_100)
        self.assertEqual(first, second)
        self.assertEqual(fyers.calls, 1)


class ScannerEngineSmokeTests(unittest.IsolatedAsyncioTestCase):
    async def test_scanner_engine_serializes_metadata_for_bullish_result(self) -> None:
        engine = ScannerEngine(_FakeScannerFyers("bullish"))

        result = await engine.run("VWAP_BREAKOUT", {"resolution": "5"}, "NIFTY50")
        row = result["results"][0]

        self.assertEqual(row["side"], "BUY")
        self.assertIn("confidence", row)
        self.assertEqual(row["scoreType"], "rule_based_confluence")
        self.assertFalse(row["calibrated"])
        self.assertEqual(row["scoreRange"], [25, 95])
        self.assertEqual(row["intendedSide"], "bullish")
        self.assertIsInstance(row["breakdown"], list)

    async def test_scanner_engine_serializes_metadata_for_bearish_result(self) -> None:
        engine = ScannerEngine(_FakeScannerFyers("bearish"))

        result = await engine.run("VOLUME_SPIKE", {"resolution": "5", "minVolume": 1_000_000}, "NIFTY50")
        row = result["results"][0]

        self.assertEqual(row["side"], "SELL")
        self.assertEqual(row["intendedSide"], "bearish")
        self.assertGreaterEqual(row["factors"]["trend"], 0)
        self.assertEqual(row["scoreRange"], [25, 95])

    async def test_scanner_engine_fails_safely_for_insufficient_history(self) -> None:
        engine = ScannerEngine(_FakeScannerFyers("insufficient"))

        result = await engine.run("VWAP_BREAKOUT", {"resolution": "5"}, "NIFTY50")

        self.assertEqual(result["results"], [])
        self.assertEqual(result["history_ok"], 0)


class ScannerRouteSmokeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.user = models.User(id=uuid.uuid4(), fy_id="scanner-smoke")
        app.dependency_overrides[state.get_user] = lambda: self.user
        self.original_scanner = scanner_strategy_routes.scanner
        scanner_strategy_routes.scanner = _FakeRouteScanner()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        scanner_strategy_routes.scanner = self.original_scanner
        app.dependency_overrides.clear()

    def test_scanner_route_serializes_score_metadata_and_old_fields(self) -> None:
        response = self.client.post(
            "/api/scanner/run",
            json={"type": "VWAP_BREAKOUT", "params": {"universe": "NIFTY50", "resolution": "5", "scanId": 1}},
        )
        self.assertEqual(response.status_code, 200)
        row = response.json()["results"][0]
        self.assertIn("confidence", row)
        self.assertIn("factors", row)
        self.assertEqual(row["scoreType"], "rule_based_confluence")
        self.assertFalse(row["calibrated"])
        self.assertEqual(row["scoreRange"], [25, 95])
        self.assertIsInstance(row["breakdown"], list)


def _scanner_context(**overrides):
    context = {
        "close": 105,
        "vwap": 101,
        "ema20": 103,
        "ema50": 100,
        "avg_volume": 100,
        "current_volume": 200,
        "chp": 2,
        "day_high": 106,
        "day_low": 94,
        "atr": 2,
    }
    context.update(overrides)
    return context


def _candles(count: int, start: int, step: int):
    candles = []
    for index in range(count):
        close = 100 + index * 0.3
        candles.append([start + index * step, close - 0.2, close + 0.4, close - 0.6, close, 1000 + index])
    return candles


def _signal_candles(direction: str):
    if direction == "insufficient":
        return _candles(20, start=1_700_000_000, step=300)

    candles = []
    for index in range(49):
        close = 100 + index * 0.2 if direction == "bullish" else 120 - index * 0.2
        candles.append([1_700_000_000 + index * 300, close - 0.2, close + 0.4, close - 0.6, close, 1000])

    if direction == "bullish":
        candles.append([1_700_014_700, 110, 115, 109, 114.8, 8000])
    else:
        candles.append([1_700_014_700, 110, 111, 104, 104.2, 8000])
    return candles


class _FakeScannerFyers:
    def __init__(self, direction: str) -> None:
        self.direction = direction

    async def quotes(self, symbols):
        chp = -4 if self.direction == "bearish" else 4
        ltp = 104.2 if self.direction == "bearish" else 114.8
        return {"d": [{"n": "NSE:TEST-EQ", "v": {"lp": ltp, "prev_close_price": 109, "volume": 2_000_000, "chp": chp}}]}

    async def history(self, symbol, resolution, frm, to):
        return {"s": "ok", "candles": _signal_candles(self.direction)}


class _FakeRouteScanner:
    async def run(self, kind, params, universe=None):
        return {
            "results": [
                {
                    "symbol": "NSE:TEST-EQ",
                    "side": "BUY",
                    "ltp": 100,
                    "chp": 1.2,
                    "volume": 1000,
                    "signal": kind,
                    "entry": 100,
                    "sl": 98,
                    "t1": 103,
                    "t2": 105,
                    "confidence": 55,
                    "factors": {"trend": -10, "volume": 10},
                    "breakdown": [
                        {
                            "component": "trend",
                            "rawValue": "bearish",
                            "normalizedValue": -0.4,
                            "weight": 25,
                            "pointsContributed": -10,
                            "direction": "bearish",
                            "missingData": False,
                            "reason": "Route smoke fixture.",
                        }
                    ],
                    "intendedSide": "bullish",
                    "scoreType": "rule_based_confluence",
                    "calibrated": False,
                    "scoreRange": [25, 95],
                }
            ],
            "scanned": 1,
            "history_requested": 1,
            "history_ok": 1,
            "history_failed": 0,
        }


if __name__ == "__main__":
    unittest.main()
