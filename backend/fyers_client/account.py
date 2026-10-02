import httpx
from typing import Any

from .common import ACCOUNT_API


class FyersAccountMixin:
    def _headers(self) -> dict[str, str]:
        ...

    async def positions(self) -> dict[str, Any]:
        ...

    async def profile(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{ACCOUNT_API}/profile", headers=self._headers())
        if r.status_code == 401:
            raise RuntimeError("AUTH_EXPIRED")
        if r.status_code != 200:
            raise RuntimeError(f"FYERS profile request failed ({r.status_code})")
        payload = r.json()
        return payload.get("data", {}) if isinstance(payload, dict) else {}

    async def funds(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{ACCOUNT_API}/funds", headers=self._headers())

            if r.status_code == 401:
                raise RuntimeError("AUTH_EXPIRED")

            if r.status_code != 200:
                raise RuntimeError(f"FYERS ERROR: {r.text}")

            data = r.json()
            d = data.get("fund_limit", [])

            out = {"available": 0, "utilized": 0, "total": 0}

            for f in d:
                k = str(f.get("title", "")).lower()
                if "available" in k:
                    out["available"] = f.get("equityAmount", 0)
                if "utilized" in k:
                    out["utilized"] = f.get("equityAmount", 0)
                if "total balance" in k:
                    out["total"] = f.get("equityAmount", 0)

            return out

    async def holdings(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{ACCOUNT_API}/holdings", headers=self._headers())
        if r.status_code == 401:
            raise RuntimeError("AUTH_EXPIRED")
        if r.status_code != 200:
            raise RuntimeError(f"FYERS holdings request failed ({r.status_code})")
        payload = r.json()
        return payload.get("data", {"holdings": []}) if isinstance(payload, dict) else {"holdings": []}

    async def dashboard(self) -> dict[str, Any]:
        positions = await self.positions()
        funds = await self.funds()
        mtm = sum(p.get("pl", 0) or 0 for p in (positions.get("positions") or []))
        return {
            "mtm": mtm,
            "day_change_pct": (mtm / max(funds["total"], 1)) * 100,
            "pnl_series": [],
            "top_movers": [],
        }

    # ---------- Datafeed ----------

