from fastapi import WebSocket
from typing import Set, List


class ConnectionManager:
    def __init__(self):
        self.active: List[WebSocket] = []
        self.subscribed: Set[str] = set()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, msg: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(ws)
        for d in dead:
            self.disconnect(d)
