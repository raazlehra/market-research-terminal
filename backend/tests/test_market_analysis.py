import time
import unittest

from backend.market_analysis import _completed_candles, _overall, _timeframe_snapshot


def make_candles(count: int, start: int, step: int, bullish: bool = True):
    rows = []
    for index in range(count):
        base = 100 + index * (0.25 if bullish else -0.25)
        close = base + (0.15 if bullish else -0.15)
        rows.append([start + index * step, base, max(base, close) + 0.2, min(base, close) - 0.2, close, 1000 + index])
    return rows


class MarketAnalysisTests(unittest.TestCase):
    def test_incomplete_candle_is_excluded(self) -> None:
        now = int(time.time())
        raw = make_candles(2, now - 600, 300)
        raw.append([now - 60, 100, 101, 99, 100.5, 1000])
        completed = _completed_candles(raw, 300, now)
        self.assertEqual(len(completed), 2)

    def test_snapshot_has_full_indicator_set(self) -> None:
        now = int(time.time())
        rows = make_candles(80, now - 81 * 300, 300)
        snapshot = _timeframe_snapshot(rows, 300, now)
        self.assertTrue(snapshot["available"])
        self.assertIsNotNone(snapshot["vwap"])
        self.assertIsNotNone(snapshot["ema20"])
        self.assertIsNotNone(snapshot["ema50"])
        self.assertIsNotNone(snapshot["rsi14"])
        self.assertIsNotNone(snapshot["atr14"])
        self.assertEqual(snapshot["direction"], "BULLISH")

    def test_overall_requires_multi_timeframe_alignment(self) -> None:
        timeframe = {
            "available": True,
            "fresh": True,
            "direction": "BULLISH",
            "rsi14": 60,
            "candle_confirmed": True,
            "candle_direction": "bullish",
        }
        overall = _overall({"5": timeframe, "15": timeframe, "60": timeframe})
        self.assertEqual(overall["direction"], "BULLISH")
        self.assertEqual(overall["score"], 100)


if __name__ == "__main__":
    unittest.main()
