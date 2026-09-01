import asyncio
from typing import Any

from .common import log


class FyersFeedMixin:
    app_id: str | None
    token: str | None
    _ticks: dict[str, dict[str, Any]]
    _feed: Any | None
    _mgr: Any | None
    _symbols_subscribed: set[str]
    _loop: asyncio.AbstractEventLoop | None

    def get_tick(self, symbol: str) -> dict[str, Any] | None:
        return self._ticks.get(symbol)

    async def start_feed(self, mgr: Any) -> None:
        log.info("Fyers feed start requested")

        if not self.token:
            log.info("Fyers feed not started because no token is available")
            return

        if self._feed:
            log.info("Fyers feed already running")
            return

        self._mgr = mgr
        self._loop = asyncio.get_running_loop()

        try:
            from fyers_apiv3.FyersWebsocket import data_ws

            def on_message(msg: dict[str, Any]) -> None:
                print("FYERS RAW MSG:", msg)

                sym = msg.get("symbol")
                if not sym:
                    return

                tick = {
                    "symbol": sym,
                    "ltp": msg.get("ltp"),
                    "open": msg.get("open_price"),
                    "high": msg.get("high_price"),
                    "low": msg.get("low_price"),
                    "prev_close": msg.get("prev_close_price"),
                    "volume": msg.get("volume"),
                    "bid": msg.get("bid_price"),
                    "ask": msg.get("ask_price"),
                    "oi": msg.get("OI"),
                    "ltt": msg.get("feed_time"),
                }

                print("BROADCASTING:", tick)

                self._ticks[sym] = tick

                if self._loop:
                    asyncio.run_coroutine_threadsafe(
                        mgr.broadcast({"type": "tick", "payload": tick}),
                        self._loop
                    )

            def on_open() -> None:
                log.info("FYERS WS OPEN")

                feed = self._feed
                if self._symbols_subscribed and feed is not None:
                    feed.subscribe(
                        symbols=list(self._symbols_subscribed),
                        data_type="SymbolUpdate"
                    )

            def on_error(msg: Any) -> None:
                log.error("FYERS WS ERROR")

            def on_close(msg: Any) -> None:
                log.warning("FYERS WS CLOSED")

            self._feed = data_ws.FyersDataSocket(
                access_token=f"{self.app_id}:{self.token}",
                log_path="",
                litemode=False,
                write_to_file=False,
                reconnect=True,
                on_connect=on_open,
                on_close=on_close,
                on_error=on_error,
                on_message=on_message,
            )

            log.info("Fyers feed object created")

            await asyncio.to_thread(self._feed.connect)

        except Exception:
            log.error("WS INIT FAILED")
    async def stop_feed(self) -> None:
        if self._feed:
            try:
                self._feed.close_connection()
            except Exception:
                pass

        self._feed = None
    async def subscribe(self, symbols: list[str]) -> None:
        self._symbols_subscribed.update(symbols)
        print("SUBSCRIBING:", symbols)
        print("FEED EXISTS:", self._feed is not None)
        if self._feed:
            try:
                await asyncio.to_thread(
                    self._feed.subscribe,
                    symbols=symbols,
                    data_type="SymbolUpdate"
                )
            except Exception as e:
                log.error(f"Subscribe failed: {e}")
    async def unsubscribe(self, symbols: list[str]) -> None:
        self._symbols_subscribed -= set(symbols)

        if self._feed:
            try:
                await asyncio.to_thread(
                    self._feed.unsubscribe,
                    symbols=symbols
                )
            except Exception as e:
                log.error(f"Unsubscribe failed: {e}")

