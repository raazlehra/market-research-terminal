import unittest

from pydantic import ValidationError

from backend.routes.scanner_strategy_routes import ScannerRequest
from backend.scanner_engine.engine import ScannerEngine, _prefilter_quotes, _resolution_seconds, _signal_side
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
        self.assertEqual(_resolution_seconds("5"), 300)
        self.assertEqual(_resolution_seconds("15"), 900)


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


if __name__ == "__main__":
    unittest.main()
