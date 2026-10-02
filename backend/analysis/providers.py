import re
import time
from datetime import datetime, timezone
from typing import Any, Protocol

import httpx

from .futures import FyersFuturesMarketDataAdapter
from .indicators import calculate_indicators


class ReadOnlyMarketDataProvider(Protocol):
    async def stock_snapshot(self, symbol: str, resolution: str, days: int) -> dict[str, Any]: ...
    async def option_snapshot(self, symbol: str, expiry: str | None) -> dict[str, Any]: ...
    async def futures_snapshot(self, symbol: str, contract_symbol: str | None = None) -> dict[str, Any]: ...


class CryptoMarketDataProvider(Protocol):
    async def market_snapshot(self, symbol: str, interval: str, limit: int = 200) -> dict[str, Any]: ...


def _number(value: Any, default: float | None = None) -> float | None:
    try:
        return float(value) if value not in (None, "") else default
    except (TypeError, ValueError):
        return default


def _quote_value(row: dict[str, Any], *keys: str) -> float | None:
    nested = row.get("v") if isinstance(row.get("v"), dict) else {}
    for key in keys:
        if key in nested:
            return _number(nested.get(key))
        if key in row:
            return _number(row.get(key))
    return None


def _candles(raw: Any) -> list[dict[str, Any]]:
    rows = raw.get("candles", raw.get("data", {}).get("candles", [])) if isinstance(raw, dict) else []
    normalized: list[dict[str, Any]] = []
    for item in rows if isinstance(rows, list) else []:
        if not isinstance(item, (list, tuple)) or len(item) < 6:
            continue
        values = [_number(value) for value in item[:6]]
        if any(value is None for value in values):
            continue
        ts, open_, high, low, close, volume = values
        if high is not None and low is not None and close is not None and open_ is not None and high >= low and close > 0 and open_ > 0:
            normalized.append({"timestamp": int(ts or 0), "open": open_, "high": high, "low": low, "close": close, "volume": volume or 0})
    normalized.sort(key=lambda row: row["timestamp"])
    return normalized


class FyersReadOnlyMarketDataProvider:
    """Capability-limited adapter; it has no order, position-mutation, or execution API."""

    def __init__(
        self, client: Any, futures_adapter: FyersFuturesMarketDataAdapter | None = None
    ) -> None:
        self._client = client
        self.futures_adapter = futures_adapter or FyersFuturesMarketDataAdapter(client)

    async def stock_snapshot(self, symbol: str, resolution: str = "D", days: int = 180) -> dict[str, Any]:
        now = int(time.time())
        quote_response = await self._client.quotes([symbol])
        history_response = await self._client.history(symbol, resolution, now - days * 86400, now)
        quote_rows = quote_response.get("d", []) if isinstance(quote_response, dict) else []
        quote = quote_rows[0] if quote_rows and isinstance(quote_rows[0], dict) else {}
        candles = _candles(history_response)
        ltp = _quote_value(quote, "lp", "ltp") or (candles[-1]["close"] if candles else None)
        previous = _quote_value(quote, "prev_close_price", "prev_close")
        change = _quote_value(quote, "ch")
        if change is None and ltp is not None and previous is not None:
            change = ltp - previous
        change_pct = _quote_value(quote, "chp")
        if change_pct is None and change is not None and previous:
            change_pct = change / previous * 100
        data_ts = candles[-1]["timestamp"] if candles else now
        return {
            "instrument": {"asset_type": "equity", "exchange": symbol.split(":", 1)[0] if ":" in symbol else "NSE", "symbol": symbol},
            "market": {
                "last_price": ltp, "change": change, "change_percent": change_pct,
                "open": _quote_value(quote, "open_price", "open"), "high": _quote_value(quote, "high_price", "high"),
                "low": _quote_value(quote, "low_price", "low"), "previous_close": previous,
                "volume": _quote_value(quote, "volume", "vol_traded_today"),
            },
            "candles": candles,
            "indicators": calculate_indicators(candles),
            "data_timestamp": datetime.fromtimestamp(data_ts, timezone.utc).isoformat(),
            "data_freshness": "REAL TIME" if now - data_ts <= 900 else "DELAYED",
            "data_sources": ["FYERS v3 quotes", "FYERS v3 history"],
        }

    async def option_snapshot(self, symbol: str, expiry: str | None = None) -> dict[str, Any]:
        chain = await self._client.option_chain(symbol, expiry)
        rows = chain.get("chain", []) if isinstance(chain, dict) else []
        ce_oi = float(chain.get("ce_oi") or 0) if isinstance(chain, dict) else 0
        pe_oi = float(chain.get("pe_oi") or 0) if isinstance(chain, dict) else 0
        important = sorted(
            ({"strike": float(row.get("strike") or 0), "oi": max(float((row.get("ce") or {}).get("oi") or 0), float((row.get("pe") or {}).get("oi") or 0))} for row in rows if isinstance(row, dict)),
            key=lambda item: item["oi"], reverse=True,
        )[:5]
        try:
            futures = await self.futures_adapter.market_snapshot(symbol)
        except (ValueError, RuntimeError, httpx.HTTPError) as exc:
            futures = {"available": False, "reason": str(exc)}
        sources = ["FYERS v3 option chain", "FYERS v3 history"]
        sources.extend(source for source in futures.get("data_sources", []) if source not in sources)
        futures_timestamp = futures.get("data_timestamp")
        futures_freshness = futures.get("data_freshness")
        return {
            "instrument": {"asset_type": "fno", "underlying": symbol, "exchange": symbol.split(":", 1)[0] if ":" in symbol else "NSE", "expiry": chain.get("expiry")},
            "market": {"spot": chain.get("spot"), "pcr": round(pe_oi / ce_oi, 2) if ce_oi else None, "ce_oi": ce_oi, "pe_oi": pe_oi, "atm": chain.get("atm")},
            "chain": rows,
            "indicators": (chain.get("analysis") or {}).get("timeframes", {}).get("15", {}),
            "important_strikes": [row["strike"] for row in important if row["strike"] > 0],
            "futures": futures,
            "data_timestamp": futures_timestamp or chain.get("fetched_at") or datetime.now(timezone.utc).isoformat(),
            "data_freshness": "DELAYED" if not rows or futures_freshness == "DELAYED" else "REAL TIME",
            "data_sources": sources,
        }

    async def futures_snapshot(self, symbol: str, contract_symbol: str | None = None) -> dict[str, Any]:
        return await self.futures_adapter.market_snapshot(symbol, contract_symbol)


class BinancePublicMarketDataProvider:
    """Public market-data-only client. No credentials or signed endpoints exist here."""

    BASE_URL = "https://data-api.binance.vision"
    INTERVALS = {"15m", "1h", "4h", "1d"}

    def __init__(self, http: httpx.AsyncClient | None = None) -> None:
        self._http = http or httpx.AsyncClient(timeout=15, follow_redirects=True)

    @staticmethod
    def normalize_symbol(symbol: str) -> str:
        cleaned = re.sub(r"[^A-Z0-9]", "", str(symbol).upper())
        if cleaned.endswith("USD") and not cleaned.endswith("USDT"):
            cleaned = f"{cleaned[:-3]}USDT"

        if not cleaned.endswith("USDT"):
            cleaned += "USDT"
        if not re.fullmatch(r"[A-Z0-9]{3,16}USDT", cleaned):
            raise ValueError("Unsupported crypto symbol")
        return cleaned

    async def market_snapshot(self, symbol: str, interval: str = "1h", limit: int = 200) -> dict[str, Any]:
        pair = self.normalize_symbol(symbol)
        timeframe = interval if interval in self.INTERVALS else "1h"
        count = max(30, min(int(limit), 500))
        ticker_response = await self._http.get(f"{self.BASE_URL}/api/v3/ticker/24hr", params={"symbol": pair})
        ticker_response.raise_for_status()
        candle_response = await self._http.get(f"{self.BASE_URL}/api/v3/klines", params={"symbol": pair, "interval": timeframe, "limit": count})
        candle_response.raise_for_status()
        ticker = ticker_response.json()
        raw_rows = candle_response.json()
        candles = []
        for row in raw_rows if isinstance(raw_rows, list) else []:
            if not isinstance(row, list) or len(row) < 6:
                continue
            candles.append({"timestamp": int(row[0]) // 1000, "open": float(row[1]), "high": float(row[2]), "low": float(row[3]), "close": float(row[4]), "volume": float(row[5])})
        now = int(time.time())
        data_ts = candles[-1]["timestamp"] if candles else now
        return {
            "instrument": {"asset_type": "crypto", "symbol": pair, "base_asset": pair[:-4], "quote_asset": "USDT", "provider": "Binance public market data"},
            "market": {
                "last_price": _number(ticker.get("lastPrice")), "change": _number(ticker.get("priceChange")),
                "change_percent_24h": _number(ticker.get("priceChangePercent")), "open_24h": _number(ticker.get("openPrice")),
                "high_24h": _number(ticker.get("highPrice")), "low_24h": _number(ticker.get("lowPrice")),
                "base_volume_24h": _number(ticker.get("volume")), "quote_volume_24h": _number(ticker.get("quoteVolume")),
                "market_cap": None, "circulating_supply": None,
            },
            "candles": candles,
            "indicators": calculate_indicators(candles),
            "data_timestamp": datetime.fromtimestamp(data_ts, timezone.utc).isoformat(),
            "data_freshness": "REAL TIME" if now - data_ts <= {"15m": 1800, "1h": 7200, "4h": 21600, "1d": 172800}[timeframe] else "DELAYED",
            "data_sources": ["Binance public market-data API"],
            "limitations": ["Market cap and circulating supply are unavailable from this provider.", "Prices are quoted in USDT; no implicit INR/USD conversion is performed."],
        }
