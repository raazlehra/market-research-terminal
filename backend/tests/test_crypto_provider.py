import asyncio
import json
import unittest
import uuid

import httpx
from fastapi.testclient import TestClient

from backend import models, state
from backend.analysis.providers import BinancePublicMarketDataProvider
from backend.main import app


def _response(request: httpx.Request, status: int, payload: object) -> httpx.Response:
    return httpx.Response(status, request=request, content=json.dumps(payload).encode("utf-8"), headers={"content-type": "application/json"})


class CryptoProviderTests(unittest.TestCase):
    def test_public_provider_uses_only_unsigned_get_market_requests(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.url.path.endswith("ticker/24hr"):
                return _response(request, 200, {"lastPrice": "65000", "priceChange": "1000", "priceChangePercent": "1.56", "openPrice": "64000", "highPrice": "66000", "lowPrice": "63000", "volume": "123", "quoteVolume": "8000000"})
            rows = [[1_700_000_000_000 + index * 3_600_000, str(100 + index), str(102 + index), str(99 + index), str(101 + index), str(1000 + index)] for index in range(80)]
            return _response(request, 200, rows)

        http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        provider = BinancePublicMarketDataProvider(http)
        snapshot = asyncio.run(provider.market_snapshot("BTC", "1h"))
        asyncio.run(http.aclose())

        self.assertEqual(snapshot["instrument"]["symbol"], "BTCUSDT")
        self.assertEqual(snapshot["market"]["last_price"], 65000.0)
        self.assertTrue(snapshot["indicators"]["available"])
        self.assertEqual(len(requests), 2)
        self.assertTrue(all(request.method == "GET" for request in requests))
        self.assertTrue(all("authorization" not in request.headers and "x-mbx-apikey" not in request.headers for request in requests))

    def test_provider_rate_limit_fails_explicitly(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return _response(request, 429, {"code": -1003, "msg": "rate limit"})

        http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        provider = BinancePublicMarketDataProvider(http)
        with self.assertRaises(httpx.HTTPStatusError):
            asyncio.run(provider.market_snapshot("ETHUSDT", "1h"))
        asyncio.run(http.aclose())


class AnalysisExecutionRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.user = models.User(id=uuid.uuid4(), fy_id="analysis-test")
        app.dependency_overrides[state.get_market_user] = lambda: self.user
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_malicious_agent_execution_payload_is_always_forbidden(self) -> None:
        response = self.client.post("/api/analysis/execute", json={"signal": "STRONG BUY", "symbol": "BTCUSDT", "quantity": 10, "action": "place_order"})
        self.assertEqual(response.status_code, 403)
        self.assertIn("permanently disabled", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
