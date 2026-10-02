"""Read-only broker activity queries.

This module deliberately exposes only GET operations. Order and position
mutation methods do not exist on the application FYERS client.
"""

from typing import Any

import httpx

from .common import ACCOUNT_API


class FyersAccountActivityMixin:
    def _headers(self) -> dict[str, str]:
        ...

    async def _account_get(self, resource: str, empty: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(f"{ACCOUNT_API}/{resource}", headers=self._headers())
        if response.status_code == 401:
            raise RuntimeError("AUTH_EXPIRED")
        if response.status_code != 200:
            raise RuntimeError(f"FYERS read-only request failed ({response.status_code})")
        return response.json().get("data", empty)

    async def orders(self) -> dict[str, Any]:
        return await self._account_get("orders", {"orders": []})

    async def positions(self) -> dict[str, Any]:
        return await self._account_get("positions", {"positions": []})

    async def tradebook(self) -> dict[str, Any]:
        return await self._account_get("tradebook", {"trades": []})
