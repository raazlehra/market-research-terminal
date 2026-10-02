"""Read-only FYERS futures contract discovery and normalized snapshots."""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from .indicators import calculate_indicators


SYMBOL_MASTER_URL = "https://public.fyers.in/sym_details/NSE_FO_sym_master.json"
SPOT_SYMBOLS = {
    "NIFTY": "NSE:NIFTY50-INDEX",
    "NIFTY50": "NSE:NIFTY50-INDEX",
    "BANKNIFTY": "NSE:NIFTYBANK-INDEX",
    "NIFTYBANK": "NSE:NIFTYBANK-INDEX",
    "FINNIFTY": "NSE:FINNIFTY-INDEX",
    "MIDCPNIFTY": "NSE:MIDCPNIFTY-INDEX",
}


def _number(value: Any) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _quote_value(row: dict[str, Any], *keys: str) -> float | None:
    nested = row.get("v") if isinstance(row.get("v"), dict) else {}
    for key in keys:
        value = nested.get(key, row.get(key))
        parsed = _number(value)
        if parsed is not None:
            return parsed
    return None


def _candles(payload: Any) -> list[dict[str, float | int]]:
    rows = payload.get("candles", []) if isinstance(payload, dict) else []
    result: list[dict[str, float | int]] = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, (list, tuple)) or len(row) < 6:
            continue
        values = [_number(value) for value in row[:6]]
        if any(value is None for value in values):
            continue
        timestamp, open_, high, low, close, volume = values
        if open_ and close and high is not None and low is not None and high >= low:
            result.append({
                "timestamp": int(timestamp or 0), "open": open_, "high": high,
                "low": low, "close": close, "volume": volume or 0,
            })
    return result


class FyersFuturesMarketDataAdapter:
    """Discovers active contracts from FYERS' public master and reads market data.

    No account, order, or mutation API is present. Symbol-master responses are
    cached for six hours and market quotes are batched per snapshot.
    """

    MASTER_CACHE_SECONDS = 6 * 60 * 60

    def __init__(self, client: Any, http: httpx.AsyncClient | None = None) -> None:
        self._client = client
        self._http = http or httpx.AsyncClient(timeout=40, follow_redirects=True)
        self._master_cache: tuple[float, list[dict[str, Any]]] | None = None
        self._master_lock = asyncio.Lock()

    @staticmethod
    def normalize_underlying(value: str) -> str:
        cleaned = str(value or "").upper().strip()
        if ":" in cleaned:
            cleaned = cleaned.split(":", 1)[1]
        cleaned = cleaned.removesuffix("-INDEX").removesuffix("-EQ")
        aliases = {"NIFTY50": "NIFTY", "NIFTYBANK": "BANKNIFTY"}
        return aliases.get(cleaned, cleaned)

    async def _load_master(self) -> list[dict[str, Any]]:
        if self._master_cache and time.monotonic() - self._master_cache[0] < self.MASTER_CACHE_SECONDS:
            return self._master_cache[1]
        async with self._master_lock:
            if self._master_cache and time.monotonic() - self._master_cache[0] < self.MASTER_CACHE_SECONDS:
                return self._master_cache[1]
            last_error: Exception | None = None
            for attempt in range(3):
                try:
                    response = await self._http.get(
                        SYMBOL_MASTER_URL,
                        headers={"User-Agent": "read-only-market-research-terminal/1.0"},
                    )
                    response.raise_for_status()
                    payload = response.json()
                    values = list(payload.values()) if isinstance(payload, dict) else payload
                    rows = [row for row in values if isinstance(row, dict)]
                    if not rows:
                        raise ValueError("FYERS symbol master contained no instruments")
                    self._master_cache = (time.monotonic(), rows)
                    return rows
                except (httpx.HTTPError, ValueError) as exc:
                    last_error = exc
                    if attempt < 2:
                        await asyncio.sleep(0.25 * (2 ** attempt))
            raise RuntimeError("FYERS futures symbol master is unavailable") from last_error

    async def discover_contracts(self, underlying: str, limit: int = 6) -> list[dict[str, Any]]:
        target = self.normalize_underlying(underlying)
        now = int(time.time())
        contracts: list[dict[str, Any]] = []
        for row in await self._load_master():
            if self.normalize_underlying(str(row.get("underSym") or "")) != target:
                continue
            if str(row.get("optType") or "").upper() != "XX":
                continue
            symbol = str(row.get("symTicker") or "").strip()
            expiry = int(_number(row.get("expiryDate")) or 0)
            if not symbol or expiry <= now:
                continue
            contracts.append({
                "underlying": target,
                "exchange": "NSE",
                "contract_symbol": symbol,
                "expiry_timestamp": expiry,
                "expiry": datetime.fromtimestamp(expiry, timezone.utc).date().isoformat(),
                "lot_size": int(_number(row.get("minLotSize")) or 0),
                "previous_close": _number(row.get("previousClose")),
                "previous_open_interest": _number(row.get("previousOi")),
                "instrument_type": int(_number(row.get("exInstType")) or 0),
                "master_last_update": str(row.get("lastUpdate") or ""),
            })
        contracts.sort(key=lambda item: (item["expiry_timestamp"], item["contract_symbol"]))
        return contracts[: max(1, min(limit, 12))]

    def _spot_symbol(self, underlying: str) -> str:
        target = self.normalize_underlying(underlying)
        return SPOT_SYMBOLS.get(target, f"NSE:{target}-EQ")

    async def market_snapshot(self, underlying: str, contract_symbol: str | None = None) -> dict[str, Any]:
        contracts = await self.discover_contracts(underlying)
        if not contracts:
            raise ValueError("No active FYERS futures contract was found for this underlying")
        contract = next((item for item in contracts if item["contract_symbol"] == contract_symbol), contracts[0])
        spot_symbol = self._spot_symbol(underlying)
        future_symbol = contract["contract_symbol"]
        quote_payload = await self._client.quotes([spot_symbol, future_symbol])
        quote_rows = quote_payload.get("d", []) if isinstance(quote_payload, dict) else []

        def find_quote(symbol: str) -> dict[str, Any]:
            for row in quote_rows if isinstance(quote_rows, list) else []:
                name = str(row.get("n") or row.get("symbol") or "")
                if name == symbol:
                    return row
            return {}

        spot_quote = find_quote(spot_symbol)
        future_quote = find_quote(future_symbol)
        spot_price = _quote_value(spot_quote, "lp", "ltp")
        futures_price = _quote_value(future_quote, "lp", "ltp")
        history = await self._client.history(future_symbol, "15", int(time.time()) - 30 * 86400, int(time.time()))
        candles = _candles(history)
        if futures_price is None and candles:
            futures_price = float(candles[-1]["close"])
        if futures_price is None and spot_price is None and not candles:
            raise ValueError("FYERS futures market data is unavailable or authentication has expired")
        basis = futures_price - spot_price if futures_price is not None and spot_price is not None else None
        basis_percent = basis / spot_price * 100 if basis is not None and spot_price else None
        current_oi = _quote_value(future_quote, "oi", "open_interest", "OI")
        previous_oi = contract.get("previous_open_interest")
        oi_change = current_oi - previous_oi if current_oi is not None and previous_oi is not None else None
        data_ts = int(candles[-1]["timestamp"]) if candles else int(time.time())
        expiry_days = max(0, int((contract["expiry_timestamp"] - int(time.time())) / 86400))
        return {
            "instrument": {
                "asset_type": "future", "underlying": contract["underlying"],
                "exchange": contract["exchange"], "contract_symbol": future_symbol,
                "expiry": contract["expiry"], "lot_size": contract["lot_size"],
            },
            "market": {
                "futures_price": futures_price, "spot_price": spot_price,
                "basis": basis, "basis_percent": basis_percent,
                "premium_discount": "PREMIUM" if basis and basis > 0 else "DISCOUNT" if basis and basis < 0 else "FLAT_OR_UNAVAILABLE",
                "open": _quote_value(future_quote, "open_price", "open"),
                "high": _quote_value(future_quote, "high_price", "high"),
                "low": _quote_value(future_quote, "low_price", "low"),
                "previous_close": _quote_value(future_quote, "prev_close_price", "prev_close") or contract.get("previous_close"),
                "volume": _quote_value(future_quote, "volume", "vol_traded_today"),
                "open_interest": current_oi, "previous_open_interest": previous_oi,
                "change_in_open_interest": oi_change, "days_to_expiry": expiry_days,
            },
            "contracts": contracts,
            "candles": candles,
            "indicators": calculate_indicators(candles),
            "data_timestamp": datetime.fromtimestamp(data_ts, timezone.utc).isoformat(),
            "data_freshness": "REAL TIME" if int(time.time()) - data_ts <= 1800 else "DELAYED",
            "data_sources": ["FYERS NSE_FO symbol master", "FYERS v3 quotes", "FYERS v3 history"],
            "interpretation_limits": [
                "Open-interest changes do not identify whether participants are buyers or writers.",
                "Conventional price/OI labels are analytical interpretations, not participant-level evidence.",
            ],
        }
