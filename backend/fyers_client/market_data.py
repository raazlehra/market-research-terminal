import asyncio
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from fyers_apiv3 import fyersModel

from .common import API_BASE, DATA_API
from .symbols import normalize_symbol, normalize_symbols
from ..market_analysis import get_market_analysis


OPTION_UNDERLYINGS = {
    "NSE:NIFTY50-INDEX": {"symbol": "NSE:NIFTY50-INDEX", "step": 50},
    "NIFTY": {"symbol": "NSE:NIFTY50-INDEX", "step": 50},
    "NIFTY50": {"symbol": "NSE:NIFTY50-INDEX", "step": 50},
    "NSE:NIFTYBANK-INDEX": {"symbol": "NSE:NIFTYBANK-INDEX", "step": 100},
    "BANKNIFTY": {"symbol": "NSE:NIFTYBANK-INDEX", "step": 100},
    "NIFTYBANK": {"symbol": "NSE:NIFTYBANK-INDEX", "step": 100},
    "NSE:FINNIFTY-INDEX": {"symbol": "NSE:FINNIFTY-INDEX", "step": 50},
    "FINNIFTY": {"symbol": "NSE:FINNIFTY-INDEX", "step": 50},
    "NSE:MIDCPNIFTY-INDEX": {"symbol": "NSE:MIDCPNIFTY-INDEX", "step": 25},
    "MIDCPNIFTY": {"symbol": "NSE:MIDCPNIFTY-INDEX", "step": 25},
    "BSE:SENSEX-INDEX": {"symbol": "BSE:SENSEX-INDEX", "step": 100},
    "NSE:SENSEX-INDEX": {"symbol": "BSE:SENSEX-INDEX", "step": 100},
    "SENSEX": {"symbol": "BSE:SENSEX-INDEX", "step": 100},
}

_OPTION_CHAIN_CACHE_TTL_SECONDS = 5.0
_option_chain_cache: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}


def _option_meta(symbol: str) -> dict[str, Any]:
    key = str(symbol or "").strip().upper()
    return OPTION_UNDERLYINGS.get(key, {"symbol": normalize_symbol(symbol), "step": 50})


def _to_float(value: Any, default: float | None = 0) -> float | None:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _first_number(source: dict[str, Any], keys: list[str], default: float = 0) -> float:
    for key in keys:
        value = _to_float(source.get(key), None)
        if value is not None:
            return value
    return default


def _empty_option_chain(symbol: str, expiry: str | None = None, message: str = "") -> dict[str, Any]:
    return {
        "symbol": symbol,
        "expiry": expiry,
        "spot": 0,
        "atm": None,
        "step": _option_meta(symbol)["step"],
        "chain": [],
        "pcr": 0,
        "ce_oi": 0,
        "pe_oi": 0,
        "expiries": [],
        "vwap": None,
        "ema20": None,
        "ema50": None,
        "vwap15": None,
        "ema2015": None,
        "ema5015": None,
        "vwap60": None,
        "ema2060": None,
        "ema5060": None,
        "message": message,
    }


class FyersMarketDataMixin:
    app_id: str | None
    token: str | None
    http: httpx.AsyncClient

    def _headers(self) -> dict[str, str]:
        ...

    async def quotes(self, symbols: list[str]) -> dict[str, Any]:
        r = await self.http.get(
            f"{API_BASE}/quotes",
            params={
                "symbols": ",".join(normalize_symbols(symbols))
            },
            headers=self._headers(),
            follow_redirects=True
        )

        if r.status_code != 200:
            print("QUOTE ERROR =", r.text)
            return {"d": []}

        return r.json()
    def quotes_sync(self, symbols: list[str]) -> dict[str, Any]:
        with httpx.Client(timeout=20) as c:
            r = c.get(
                f"{API_BASE}/quotes",
                params={
                    "symbols": ",".join(normalize_symbols(symbols))
                },
                headers=self._headers(),
                follow_redirects=True
            )

            if r.status_code != 200:
                print("QUOTE ERROR =", r.text)
                return {"d": []}

            return r.json()
    async def depth(self, symbol: str) -> dict[str, Any]:
        async with self.http as c:
            r = await c.post(f"{DATA_API}/depth/", json={"symbol": symbol, "ohlcv_flag": 1}, headers=self._headers())
            return r.json()
    async def history(self, symbol: str, resolution: str, frm: int, to: int) -> dict[str, Any]:
        symbol = normalize_symbol(symbol)

        r = await self.http.get(
            "https://api-t1.fyers.in/data/history",
            params={
                "symbol": symbol,
                "resolution": resolution,
                "date_format": "0",
                "range_from": frm,
                "range_to": to,
                "cont_flag": 1
            },
            headers=self._headers(),
            follow_redirects=True
        )

        if r.status_code != 200:
            return {
                "s": "error",
                "code": r.status_code,
                "message": r.text
            }

        return r.json()
    async def option_chain(self, symbol: str, expiry: str | None = None) -> dict[str, Any]:
        if not self.app_id or not self.token:
            return _empty_option_chain(symbol, expiry, "Fyers option-chain requires login.")
        app_id = self.app_id
        token = self.token
        meta = _option_meta(symbol)
        symbol = meta["symbol"]
        step = meta["step"]
        expiry_timestamp = str(expiry or "")
        cache_key = (symbol, expiry_timestamp)
        cached = _option_chain_cache.get(cache_key)
        if cached and time.monotonic() - cached[0] < _OPTION_CHAIN_CACHE_TTL_SECONDS:
            return cached[1]

        def _fetch():
            fy = fyersModel.FyersModel(
                client_id=app_id,
                token=token,
                log_path=""
            )

            payload = {
                "symbol": symbol,
                "strikecount": 20,
                "timestamp": expiry_timestamp
            }

            return fy.optionchain(data=payload)

        raw = await asyncio.to_thread(_fetch)

        if not raw:
            print("OPTIONCHAIN RETURNED NONE")
            return _empty_option_chain(symbol, expiry_timestamp, "Fyers returned no option-chain data.")

        if not isinstance(raw, dict):
            print("INVALID OPTION RESPONSE:", raw)
            return _empty_option_chain(symbol, expiry_timestamp, "Invalid Fyers option-chain response.")

        if raw.get("s") != "ok":
            print("OPTIONCHAIN ERROR =", raw)
            return _empty_option_chain(symbol, expiry_timestamp, str(raw.get("message") or "Fyers option-chain request failed."))

        data = raw.get("data", {})
        if not isinstance(data, dict):
            print("INVALID OPTION DATA:", raw)
            return _empty_option_chain(symbol, expiry_timestamp, "Fyers option-chain data was not an object.")

        chain = data.get("optionsChain") or data.get("options_chain") or []
        if not isinstance(chain, list):
            print("INVALID OPTION CHAIN:", raw)
            return _empty_option_chain(symbol, expiry_timestamp, "Fyers option-chain rows were not a list.")

        spot = _first_number(data, ["spotPrice", "spot_price", "underlyingValue", "underlying_value", "spot", "ltp"], 0)
        rows_map: dict[float, dict[str, Any]] = {}

        for item in chain:
            if not isinstance(item, dict):
                continue

            opt_type = str(item.get("option_type") or item.get("optionType") or item.get("type") or "").upper()
            strike = _to_float(item.get("strike_price", item.get("strikePrice", item.get("strike"))), None)

            # spot/index row
            if opt_type == "" and (strike in (None, -1, 0) or str(item.get("symbol") or "").upper() == symbol):
                spot = _first_number(item, ["ltp", "last_price", "spot", "value"], spot)
                continue

            if opt_type not in ("CE", "PE") or strike is None:
                continue

            if strike not in rows_map:
                rows_map[strike] = {
                    "strike": int(strike) if float(strike).is_integer() else strike,
                    "ce": None,
                    "pe": None
                }

            mapped: dict[str, Any] = {
                "symbol": item.get("symbol") or item.get("fyToken") or "",
                "oi": _to_int(item.get("oi", item.get("open_interest"))),
                "oi_change": _to_int(item.get("oich", item.get("oi_change", item.get("oiChange")))),
                "volume": _to_int(item.get("volume", item.get("vol_traded_today"))),
                "iv": _to_float(item.get("iv", item.get("implied_volatility"))),
                "ltp": _to_float(item.get("ltp", item.get("last_price"))),
                "bid": _to_float(item.get("bid", item.get("bid_price"))),
                "ask": _to_float(item.get("ask", item.get("ask_price"))),
            }

            if opt_type == "CE":
                rows_map[strike]["ce"] = mapped
            elif opt_type == "PE":
                rows_map[strike]["pe"] = mapped

        rows = sorted(rows_map.values(), key=lambda x: x["strike"])
        for row in rows:
            strike = float(_to_float(row["strike"], 0) or 0)
            if row["ce"]:
                row["ce"]["itm"] = bool(spot and strike < spot)
            if row["pe"]:
                row["pe"]["itm"] = bool(spot and strike > spot)

        atm = round(spot / step) * step if spot else None
        ce_oi = _to_int(data.get("callOi", data.get("ce_oi")))
        pe_oi = _to_int(data.get("putOi", data.get("pe_oi")))
        if not ce_oi:
            ce_oi = sum(row["ce"]["oi"] for row in rows if row.get("ce"))
        if not pe_oi:
            pe_oi = sum(row["pe"]["oi"] for row in rows if row.get("pe"))

        analysis: dict[str, Any] = {}
        try:
            analysis = await get_market_analysis(self.history, symbol) if spot else {}
        except Exception as error:
            print("MARKET ANALYSIS ERROR:", error)
        analysis_timeframes = analysis.get("timeframes", {}) if isinstance(analysis, dict) else {}
        analysis_5 = analysis_timeframes.get("5", {})
        analysis_15 = analysis_timeframes.get("15", {})
        analysis_60 = analysis_timeframes.get("60", {})
        vwap = analysis_5.get("vwap")
        ema20 = analysis_5.get("ema20")
        ema50 = analysis_5.get("ema50")
        vwap15 = analysis_15.get("vwap")
        ema2015 = analysis_15.get("ema20")
        ema5015 = analysis_15.get("ema50")
        vwap60 = analysis_60.get("vwap")
        ema2060 = analysis_60.get("ema20")
        ema5060 = analysis_60.get("ema50")

        result = {
            "symbol": symbol,
            "expiry": expiry_timestamp,
            "spot": spot,
            "atm": atm,
            "step": step,
            "chain": rows,
            "pcr": round(pe_oi / ce_oi, 2) if ce_oi else 0,
            "ce_oi": ce_oi,
            "pe_oi": pe_oi,
            "expiries": data.get("expiryData", []),
            "vwap": vwap,
            "ema20": ema20,
            "ema50": ema50,
            "vwap15": vwap15,
            "ema2015": ema2015,
            "ema5015": ema5015,
            "vwap60": vwap60,
            "ema2060": ema2060,
            "ema5060": ema5060,
            "analysis": analysis,
            "message": "" if rows else "No option-chain rows returned for this symbol/expiry.",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
        _option_chain_cache[cache_key] = (time.monotonic(), result)
        return result
    async def expiries(self, symbol: str) -> list[dict[str, Any]]:
        oc = await self.option_chain(symbol)
        if not oc:
                    return []
        expiries = oc.get("expiries", [])
        out = []

        for exp in expiries:
            out.append({
                "date": exp.get("date"),
                "expiry": exp.get("expiry"),
                "flag": exp.get("expiry_flag")
            })

        return out

    # ---------- Orders / positions / trades ----------

