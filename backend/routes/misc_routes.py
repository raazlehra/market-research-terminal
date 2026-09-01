import json
import logging
from typing import Any, Protocol, cast

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..database import SessionLocal
from ..state import authenticate_bearer_token, fyers, mgr

router = APIRouter()
log = logging.getLogger("fno-misc")
JsonRecord = dict[str, Any]


class MarketFeedClient(Protocol):
    ready: bool

    async def quotes(self, symbols: list[str]) -> JsonRecord:
        ...

    async def start_feed(self, mgr: Any) -> None:
        ...

    async def subscribe(self, symbols: list[str]) -> None:
        ...

    async def unsubscribe(self, symbols: list[str]) -> None:
        ...


typed_fyers = cast(MarketFeedClient, fyers)


def _websocket_token(ws: WebSocket, query_token: str | None = None) -> str:
    auth = ws.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        return auth.split(" ", 1)[1].strip()
    return (query_token or "").strip()


@router.websocket("/ws/market")
async def ws_market(ws: WebSocket, token: str | None = None) -> None:
    d = SessionLocal()
    try:
        user = authenticate_bearer_token(_websocket_token(ws, token), d)
    finally:
        d.close()

    if not user:
        await ws.close(code=1008)
        return

    await mgr.connect(ws)
    try:
        while True:
            msg = await ws.receive_text()
            try:
                data = json.loads(msg)
                if data.get("op") == "subscribe":
                    for symbol in data.get("symbols", []):
                        mgr.subscribed.add(symbol)
                    log.debug("WebSocket market subscribe requested")
                    if not typed_fyers.ready:
                        continue

                    await typed_fyers.start_feed(mgr)
                    await typed_fyers.subscribe([str(symbol) for symbol in data.get("symbols", [])])
                elif data.get("op") == "unsubscribe":
                    for symbol in data.get("symbols", []):
                        mgr.subscribed.discard(symbol)
                    await typed_fyers.unsubscribe([str(symbol) for symbol in data.get("symbols", [])])
            except Exception:
                pass
    except WebSocketDisconnect:
        mgr.disconnect(ws)
