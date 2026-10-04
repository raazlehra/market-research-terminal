import asyncio
import logging
from typing import Any

from backend.fyers_client.feed import FyersFeedMixin


class FakeManager:
    def __init__(self) -> None:
        self.broadcasts: list[dict[str, Any]] = []

    async def broadcast(self, message: dict[str, Any]) -> None:
        self.broadcasts.append(message)


class FakeDataSocket:
    def __init__(self, **kwargs: Any) -> None:
        self.kwargs = kwargs
        self.connected = False
        self.subscribe_calls: list[tuple[list[str], str]] = []
        self.unsubscribe_calls: list[list[str]] = []

    def connect(self) -> None:
        self.connected = True

    def subscribe(self, symbols: list[str], data_type: str) -> None:
        self.subscribe_calls.append((symbols, data_type))

    def unsubscribe(self, symbols: list[str]) -> None:
        self.unsubscribe_calls.append(symbols)


class FeedClient(FyersFeedMixin):
    def __init__(self) -> None:
        self.app_id = "synthetic-app"
        self.token = "synthetic-token"
        self._ticks: dict[str, dict[str, Any]] = {}
        self._feed: Any | None = None
        self._mgr: Any | None = None
        self._symbols_subscribed: set[str] = set()
        self._loop: asyncio.AbstractEventLoop | None = None


def test_feed_message_logging_is_bounded_and_tick_behavior_is_preserved(
    monkeypatch,
    caplog,
    capsys,
) -> None:
    from fyers_apiv3.FyersWebsocket import data_ws

    created: dict[str, FakeDataSocket] = {}

    def create_socket(**kwargs: Any) -> FakeDataSocket:
        socket = FakeDataSocket(**kwargs)
        created["socket"] = socket
        return socket

    monkeypatch.setattr(data_ws, "FyersDataSocket", create_socket)
    caplog.set_level(logging.DEBUG, logger="fyers")
    payload = {
        "symbol": "NSE:RELIANCE-EQ",
        "ltp": 2945.6,
        "open_price": 2910.0,
        "high_price": 2960.0,
        "low_price": 2895.0,
        "prev_close_price": 2900.0,
        "volume": 123456,
        "bid_price": 2945.5,
        "ask_price": 2945.7,
        "OI": 98765,
        "feed_time": 1700000000,
        "access_token": "synthetic-access-token-marker",
        "refresh_token": "synthetic-refresh-token-marker",
        "authorization": "synthetic-authorization-marker",
        "secret": "synthetic-secret-marker",
    }

    async def exercise() -> tuple[FeedClient, FakeManager]:
        client = FeedClient()
        manager = FakeManager()
        await client.start_feed(manager)
        socket = created["socket"]
        socket.kwargs["on_message"](payload)
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        return client, manager

    client, manager = asyncio.run(exercise())
    expected_tick = {
        "symbol": "NSE:RELIANCE-EQ",
        "ltp": 2945.6,
        "open": 2910.0,
        "high": 2960.0,
        "low": 2895.0,
        "prev_close": 2900.0,
        "volume": 123456,
        "bid": 2945.5,
        "ask": 2945.7,
        "oi": 98765,
        "ltt": 1700000000,
    }

    assert created["socket"].connected is True
    assert client.get_tick("NSE:RELIANCE-EQ") == expected_tick
    assert manager.broadcasts == [{"type": "tick", "payload": expected_tick}]

    captured = capsys.readouterr()
    emitted = (caplog.text + captured.out + captured.err).lower()
    for forbidden in (
        "access_token",
        "refresh_token",
        "authorization",
        "secret",
        "synthetic-access-token-marker",
        "synthetic-refresh-token-marker",
        "synthetic-authorization-marker",
        "synthetic-secret-marker",
    ):
        assert forbidden not in emitted
    assert "fyers raw msg" not in emitted
    assert "broadcasting:" not in emitted
    assert "kind=symbol_update" in emitted
    assert f"fields={len(payload)}" in emitted
    assert "populated_fields=11" in emitted


def test_subscription_logging_is_bounded_and_provider_calls_are_preserved(
    caplog,
    capsys,
) -> None:
    caplog.set_level(logging.DEBUG, logger="fyers")
    client = FeedClient()
    socket = FakeDataSocket()
    client._feed = socket
    symbols = ["NSE:RELIANCE-EQ", "NSE:HDFCBANK-EQ"]

    async def exercise() -> None:
        await client.subscribe(symbols)
        await client.unsubscribe([symbols[0]])

    asyncio.run(exercise())

    assert client._symbols_subscribed == {symbols[1]}
    assert socket.subscribe_calls == [(symbols, "SymbolUpdate")]
    assert socket.unsubscribe_calls == [[symbols[0]]]

    captured = capsys.readouterr()
    emitted = caplog.text + captured.out + captured.err
    assert "symbols=2" in emitted
    assert "symbols=1" in emitted
    assert "feed_active=True" in emitted
    assert "data_type=SymbolUpdate" in emitted
    assert symbols[0] not in emitted
    assert symbols[1] not in emitted
    assert captured.out == ""


def test_provider_exception_details_are_not_logged(caplog) -> None:
    class FailingFeed(FakeDataSocket):
        def subscribe(self, symbols: list[str], data_type: str) -> None:
            raise RuntimeError(
                "authorization=synthetic-authorization-marker secret=synthetic-secret-marker"
            )

    caplog.set_level(logging.DEBUG, logger="fyers")
    client = FeedClient()
    client._feed = FailingFeed()

    asyncio.run(client.subscribe(["NSE:RELIANCE-EQ"]))

    emitted = caplog.text.lower()
    assert "error_type=runtimeerror" in emitted
    assert "authorization" not in emitted
    assert "secret" not in emitted
    assert "synthetic-authorization-marker" not in emitted
    assert "synthetic-secret-marker" not in emitted
