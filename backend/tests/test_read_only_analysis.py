import asyncio
import unittest

from backend.analysis.indicators import calculate_indicators
from backend.analysis.models import AnalysisRequest
from backend.analysis.service import AnalysisService, ExecutionDisabledError
from backend.fyers_client import FyersClient


def candles(direction: int = 1) -> list[dict[str, float]]:
    rows = []
    for index in range(80):
        close = 100 + direction * index
        rows.append({"timestamp": 1_700_000_000 + index * 3600, "open": close - direction * 0.2, "high": close + 1, "low": close - 1, "close": close, "volume": 1000 + index})
    return rows


class FakeMarketProvider:
    async def stock_snapshot(self, symbol: str, resolution: str, days: int):
        rows = candles(1)
        return {"instrument": {"symbol": symbol}, "market": {"last_price": rows[-1]["close"]}, "candles": rows, "indicators": calculate_indicators(rows), "data_timestamp": "2026-10-01T00:00:00+00:00", "data_freshness": "REAL TIME", "data_sources": ["test"]}

    async def option_snapshot(self, symbol: str, expiry: str | None):
        return {"instrument": {"underlying": symbol}, "market": {"spot": 25000, "pcr": 1.0}, "indicators": {"direction": "MIXED", "rsi14": 50}, "important_strikes": [25000], "data_timestamp": "2026-10-01T00:00:00+00:00", "data_freshness": "REAL TIME", "data_sources": ["test"]}


class FakeCryptoProvider:
    async def market_snapshot(self, symbol: str, interval: str):
        rows = candles(-1)
        return {"instrument": {"symbol": symbol}, "market": {"last_price": rows[-1]["close"]}, "candles": rows, "indicators": calculate_indicators(rows), "data_timestamp": "2026-10-01T00:00:00+00:00", "data_freshness": "REAL TIME", "data_sources": ["test"]}


class ReadOnlyAnalysisTests(unittest.TestCase):
    def test_fyers_client_has_no_mutation_capabilities(self) -> None:
        client = FyersClient()
        for method in ("place_order", "modify_order", "cancel_order", "exit_position", "squareoff_all", "execute_trade", "buy", "sell"):
            self.assertFalse(hasattr(client, method), method)

    def test_stock_and_crypto_signals_are_analysis_only(self) -> None:
        service = AnalysisService(FakeMarketProvider(), FakeCryptoProvider())
        stock = asyncio.run(service.analyze(AnalysisRequest(asset_type="equity", symbol="NSE:TEST-EQ", horizon="Swing")))
        crypto = asyncio.run(service.analyze(AnalysisRequest(asset_type="crypto", symbol="BTCUSDT", horizon="Swing")))
        for result in (stock, crypto):
            self.assertFalse(result.execution_enabled)
            self.assertEqual(result.signal_type, "analysis_only")

    def test_malicious_execution_request_is_rejected(self) -> None:
        service = AnalysisService(FakeMarketProvider(), FakeCryptoProvider())
        with self.assertRaises(ExecutionDisabledError):
            service.reject_execution({"action": "SELL", "symbol": "BTCUSDT", "quantity": 999})


if __name__ == "__main__":
    unittest.main()
