import httpx
from typing import Any

from .common import API_BASE


class FyersOrdersMixin:
    def _headers(self) -> dict[str, str]:
        ...

    async def orders(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{API_BASE}/orders", headers=self._headers())

            if r.status_code == 401:
                raise RuntimeError("AUTH_EXPIRED")

            if r.status_code != 200:
                raise RuntimeError(r.text)

            return r.json().get("data", {"orders": []})
    async def positions(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{API_BASE}/positions", headers=self._headers())

            if r.status_code == 401:
                raise RuntimeError("AUTH_EXPIRED")

            if r.status_code != 200:
                raise RuntimeError(r.text)

            return r.json().get("data", {"positions": []})
    async def tradebook(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{API_BASE}/tradebook", headers=self._headers())

            if r.status_code == 401:
                raise RuntimeError("AUTH_EXPIRED")

            if r.status_code != 200:
                raise RuntimeError(r.text)

            return r.json().get("data", {"trades": []})
    async def place_order(self, payload: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(f"{API_BASE}/orders/sync", json=payload, headers=self._headers())
            return r.json()
    async def modify_order(self, oid: str, payload: dict[str, Any]) -> dict[str, Any]:
        payload["id"] = oid
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.put(f"{API_BASE}/orders/sync", json=payload, headers=self._headers())
            return r.json()
    async def cancel_order(self, oid: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.delete(f"{API_BASE}/orders/sync?id={oid}", headers=self._headers())
            return r.json()
    async def exit_position(self, payload: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(f"{API_BASE}/positions", json=payload, headers=self._headers())
            return r.json()
    async def squareoff_all(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.request("DELETE", f"{API_BASE}/positions", json={"exit_all": 1}, headers=self._headers())
            return r.json()

