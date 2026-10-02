import asyncio
import json
import time
import unittest

import httpx

from backend.analysis.futures import FyersFuturesMarketDataAdapter
from backend.analysis.providers import FyersReadOnlyMarketDataProvider


def response(request: httpx.Request, payload: object, status: int = 200) -> httpx.Response:
    return httpx.Response(status, request=request, content=json.dumps(payload).encode(), headers={"content-type": "application/json"})


class FakeFyersClient:
    async def quotes(self, symbols: list[str]):
        return {
            "d": [
                {"n": symbols[0], "v": {"lp": 25000}},
                {"n": symbols[1], "v": {"lp": 25100, "oi": 12000, "volume": 5000, "open_price": 25050, "high_price": 25200, "low_price": 24900}},
            ]
        }

    async def history(self, symbol: str, resolution: str, start: int, end: int):
        return {"candles": [[1_800_000_000 + index * 900, 25000 + index, 25010 + index, 24990 + index, 25005 + index, 1000 + index] for index in range(80)]}


class FuturesAdapterTests(unittest.TestCase):
    def test_option_snapshot_inherits_delayed_futures_timestamp(self) -> None:
        class ChainClient:
            async def option_chain(self, symbol: str, expiry: str | None):
                return {
                    "chain": [{"strike": 25000, "ce": {"oi": 100}, "pe": {"oi": 120}}],
                    "ce_oi": 100,
                    "pe_oi": 120,
                    "spot": 25000,
                    "atm": 25000,
                    "expiry": expiry,
                    "fetched_at": "2026-10-02T09:00:00+00:00",
                }

        class DelayedFutures:
            async def market_snapshot(self, symbol: str):
                return {
                    "data_timestamp": "2026-10-01T10:00:00+00:00",
                    "data_freshness": "DELAYED",
                    "data_sources": ["FYERS v3 futures"],
                }

        provider = FyersReadOnlyMarketDataProvider(ChainClient(), DelayedFutures())
        snapshot = asyncio.run(provider.option_snapshot("NIFTY", "active"))

        self.assertEqual(snapshot["data_timestamp"], "2026-10-01T10:00:00+00:00")
        self.assertEqual(snapshot["data_freshness"], "DELAYED")

    def setUp(self) -> None:
        now = int(time.time())
        self.active_expiry = now + 20 * 86400
        payload = {
            "future": {"underSym": "NIFTY", "optType": "XX", "symTicker": "NSE:NIFTYACTIVEFUT", "expiryDate": str(self.active_expiry), "minLotSize": 25, "previousClose": 25020, "previousOi": 11000, "exInstType": 11, "lastUpdate": "2026-10-02"},
            "later": {"underSym": "NIFTY", "optType": "XX", "symTicker": "NSE:NIFTYLATERFUT", "expiryDate": str(now + 50 * 86400), "minLotSize": 25, "previousClose": 25100, "previousOi": 9000, "exInstType": 11},
            "expired": {"underSym": "NIFTY", "optType": "XX", "symTicker": "NSE:NIFTYEXPIREDFUT", "expiryDate": str(now - 86400), "exInstType": 11},
            "option": {"underSym": "NIFTY", "optType": "CE", "symTicker": "NSE:NIFTYCE", "expiryDate": str(now + 86400), "exInstType": 14},
        }
        self.requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            return response(request, payload)

        self.http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        self.adapter = FyersFuturesMarketDataAdapter(FakeFyersClient(), self.http)

    def tearDown(self) -> None:
        asyncio.run(self.http.aclose())

    def test_contract_discovery_excludes_options_and_expired_contracts(self) -> None:
        contracts = asyncio.run(self.adapter.discover_contracts("NSE:NIFTY50-INDEX"))
        self.assertEqual([row["contract_symbol"] for row in contracts], ["NSE:NIFTYACTIVEFUT", "NSE:NIFTYLATERFUT"])
        self.assertTrue(all(row["expiry_timestamp"] > int(time.time()) for row in contracts))
        self.assertEqual(len(self.requests), 1)
        asyncio.run(self.adapter.discover_contracts("NIFTY"))
        self.assertEqual(len(self.requests), 1, "symbol master should be cached")

    def test_snapshot_matches_spot_and_future_and_calculates_basis_and_oi(self) -> None:
        snapshot = asyncio.run(self.adapter.market_snapshot("NIFTY"))
        self.assertEqual(snapshot["instrument"]["contract_symbol"], "NSE:NIFTYACTIVEFUT")
        self.assertEqual(snapshot["market"]["spot_price"], 25000)
        self.assertEqual(snapshot["market"]["futures_price"], 25100)
        self.assertEqual(snapshot["market"]["basis"], 100)
        self.assertAlmostEqual(snapshot["market"]["basis_percent"], 0.4)
        self.assertEqual(snapshot["market"]["change_in_open_interest"], 1000)
        self.assertTrue(snapshot["indicators"]["available"])
        self.assertIn("FYERS NSE_FO symbol master", snapshot["data_sources"])

    def test_snapshot_rejects_missing_quote_and_history_data(self) -> None:
        class EmptyFyersClient:
            async def quotes(self, symbols: list[str]):
                return {"s": "error", "d": []}

            async def history(self, symbol: str, resolution: str, start: int, end: int):
                return {"s": "error", "candles": []}

        adapter = FyersFuturesMarketDataAdapter(EmptyFyersClient(), self.http)
        with self.assertRaisesRegex(ValueError, "market data is unavailable"):
            asyncio.run(adapter.market_snapshot("NIFTY"))
    def test_missing_underlying_fails_without_hard_coded_contract(self) -> None:
        with self.assertRaisesRegex(ValueError, "No active FYERS futures contract"):
            asyncio.run(self.adapter.market_snapshot("NOTREAL"))


if __name__ == "__main__":
    unittest.main()
