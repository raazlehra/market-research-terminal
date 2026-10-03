import uuid
import unittest
from typing import Any
from unittest.mock import AsyncMock, Mock

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.main import app
from backend import models
from backend import state
from backend.routes import paper_routes, trading_routes


class LiveOrderSafetyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.user = models.User(id=uuid.uuid4(), fy_id="safe-test")
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        models.Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine)

        def test_db():
            database = self.session_factory()
            try:
                yield database
            finally:
                database.close()

        app.dependency_overrides[state.db] = test_db
        app.dependency_overrides[state.get_user] = lambda: self.user
        app.dependency_overrides[state.get_market_user] = lambda: self.user
        self.original_quotes = trading_routes.fyers.quotes
        self.original_get_tick = paper_routes.fyers.get_tick
        self.original_paper_balance = paper_routes.paper.balance
        self.original_paper_place = paper_routes.paper.place
        self.original_paper_exit = paper_routes.paper.exit
        self.original_is_kill_switched = paper_routes.risk.is_kill_switched
        self.quotes = AsyncMock(return_value={"d": [{"symbol": "NSE:RELIANCE-EQ", "ltp": 100}]})
        self.paper_place = Mock(return_value={"ok": True, "id": "paper-1", "fill": 100})
        self.paper_exit = Mock(return_value={"status": "EXITED", "remainingQty": 0})
        self.paper_balance = Mock(return_value={"available": 100000, "netPnl": 0})
        trading_routes.fyers.quotes = self.quotes
        paper_routes.fyers.quotes = self.quotes
        def get_tick(symbol: str) -> dict[str, Any]:
            return {"symbol": symbol, "ltp": 100, "bid": 100, "ask": 100}

        paper_routes.fyers.get_tick = get_tick
        paper_routes.paper.balance = self.paper_balance
        paper_routes.paper.place = self.paper_place
        paper_routes.paper.exit = self.paper_exit
        paper_routes.risk.is_kill_switched = Mock(return_value=False)
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()
        self.engine.dispose()
        trading_routes.fyers.quotes = self.original_quotes
        paper_routes.fyers.get_tick = self.original_get_tick
        paper_routes.paper.balance = self.original_paper_balance
        paper_routes.paper.place = self.original_paper_place
        paper_routes.paper.exit = self.original_paper_exit
        paper_routes.risk.is_kill_switched = self.original_is_kill_switched

    def test_live_mutation_routes_are_always_forbidden(self) -> None:
        endpoints = [
            ("post", "/api/orders/place"),
            ("put", "/api/orders/order-1"),
            ("delete", "/api/orders/order-1"),
            ("post", "/api/positions/exit"),
            ("post", "/api/positions/squareoff-all"),
        ]
        payloads = [
            None,
            {"manualApproval": False},
            {"manualApproval": True},
            {"manualApproval": "true"},
        ]

        for method, path in endpoints:
            for payload in payloads:
                with self.subTest(path=path, payload=payload):
                    response = self.client.request(method, path, json=payload)
                    self.assertEqual(response.status_code, 403)
                    self.assertIn("Live trading is disabled", response.json()["detail"])


    def test_live_mutation_routes_ignore_malformed_json_and_forbid(self) -> None:
        endpoints = [
            ("post", "/api/orders/place"),
            ("put", "/api/orders/order-1"),
            ("delete", "/api/orders/order-1"),
            ("post", "/api/positions/exit"),
            ("post", "/api/positions/squareoff-all"),
        ]

        for method, path in endpoints:
            with self.subTest(path=path):
                response = self.client.request(method, path, content="{not-json", headers={"content-type": "application/json"})
                self.assertEqual(response.status_code, 403)


    def test_read_only_market_data_route_is_unaffected(self) -> None:
        response = self.client.post("/api/fyers/quotes", json={"symbols": ["NSE:RELIANCE-EQ"]})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["d"][0]["symbol"], "NSE:RELIANCE-EQ")
        self.quotes.assert_awaited_once()

    def test_paper_trading_route_is_unaffected(self) -> None:
        response = self.client.post(
            "/api/paper/place",
            json={
                "symbol": "NSE:RELIANCE-EQ",
                "side": "BUY",
                "qty": 1,
                "premium": 100,
                "confidence": 70,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.paper_place.assert_called_once()

    def test_paper_exit_route_is_unaffected(self) -> None:
        response = self.client.post("/api/paper/exit/paper-1", json={"qty": 1})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "EXITED")
        self.paper_exit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
