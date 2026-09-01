import asyncio
import logging
import math
import random
import time
from typing import Any, Dict, List, Protocol, Set, cast

from ..scanner_symbols import FNO, NIFTY50
from .indicators import build_context
from .scoring import score_context
from .signals import detect_signal

log = logging.getLogger("scanner")

ScannerRecord = Dict[str, Any]


class ScannerFyersClient(Protocol):
    async def quotes(self, symbols: List[str]) -> ScannerRecord:
        ...

    async def history(self, symbol: str, resolution: str, frm: int, to: int) -> ScannerRecord:
        ...


def _as_record(value: Any) -> ScannerRecord:
    return cast(ScannerRecord, value) if isinstance(value, dict) else {}


def _records_from_value(value: Any) -> List[ScannerRecord]:
    if not isinstance(value, list):
        return []
    rows = cast(List[object], value)
    return [cast(ScannerRecord, row) for row in rows if isinstance(row, dict)]


def _number(record: ScannerRecord, key: str, default: float = 0.0) -> float:
    try:
        return float(record.get(key, default))
    except (TypeError, ValueError):
        return default


def _text(record: ScannerRecord, key: str, default: str = "") -> str:
    value = record.get(key, default)
    return str(value) if value is not None else default


class ScannerEngine:
    def __init__(self, fyers: ScannerFyersClient) -> None:
        self.fyers = fyers
        self._scan_lock = asyncio.Lock()
        self._rate_lock = asyncio.Lock()
        self._next_history_request_at = 0.0
        self._global_backoff_until = 0.0
        self._history_cache: Dict[tuple[str, str, int], ScannerRecord] = {}
        self._invalid_until: Dict[str, float] = {}
        self._scan_cache: Dict[tuple[str, str, str], tuple[float, ScannerRecord]] = {}

    async def run(self, kind: str, params: ScannerRecord, universe: str = "FNO") -> ScannerRecord:
        resolution = str(params.get("resolution") or "15")
        scan_key = (kind, universe, resolution)
        cached_scan = self._scan_cache.get(scan_key)
        if cached_scan and time.monotonic() - cached_scan[0] < 30:
            cached_result = dict(cached_scan[1])
            cached_result["cached"] = True
            cached_result["cooldown_remaining"] = max(0, round(30 - (time.monotonic() - cached_scan[0])))
            return cached_result
        if self._scan_lock.locked():
            return {
                "results": [],
                "busy": True,
                "message": "Another stock scan is already running. Please wait for it to finish.",
                "universe": universe,
                "resolution": resolution,
            }

        async with self._scan_lock:
            return await self._run_scan(kind, params, universe, resolution, scan_key)

    async def _run_scan(
        self,
        kind: str,
        params: ScannerRecord,
        universe: str,
        resolution: str,
        scan_key: tuple[str, str, str],
    ) -> ScannerRecord:
        start = time.time()
        success_count = 0
        fail_count = 0
        symbols = _symbols_for_universe(universe)[:400]
        quotes_list = await self._load_quotes(symbols)
        candidates = _prefilter_quotes(kind, params, quotes_list, limit=40)
        results: List[ScannerRecord] = []

        now = int(time.time())
        semaphore = asyncio.Semaphore(2)

        async def load_history(quote: ScannerRecord) -> tuple[ScannerRecord, ScannerRecord]:
            symbol = str(quote.get("n") or quote.get("symbol") or "")
            async with semaphore:
                history = await self._fetch_history(symbol, resolution, now)
            return quote, history

        loaded = await asyncio.gather(*(load_history(quote) for quote in candidates))
        for quote, history in loaded:
            if history.get("s") != "ok":
                fail_count += 1
                continue

            ctx = build_context(quote, history)
            if not ctx:
                continue

            success_count += 1
            signal, penalty = detect_signal(kind, params, ctx)
            if not signal:
                continue

            side = _signal_side(kind, ctx)
            scored = score_context(ctx, penalty, side)
            results.append(_result_row(ctx, signal, side, scored))

        results = _dedupe(results)
        results.sort(key=lambda row: _number(row, "confidence"), reverse=True)
        elapsed = round(time.time() - start, 2)
        print("SCAN TIME =", elapsed, "seconds")
        print("HISTORY OK =", success_count)
        print("HISTORY FAILED =", fail_count)

        response = {
            "results": results[:100],
            "scanned": len(quotes_list),
            "prefiltered": len(candidates),
            "history_requested": len(candidates),
            "history_ok": success_count,
            "history_failed": fail_count,
            "elapsed": elapsed,
            "universe": universe or "FNO",
            "resolution": resolution,
            "cached": False,
            "rate_limit_per_second": 2,
        }
        self._scan_cache[scan_key] = (time.monotonic(), response)
        return response

    async def _load_quotes(self, symbols: List[str]) -> List[ScannerRecord]:
        all_quotes: List[ScannerRecord] = []
        for i in range(0, len(symbols), 50):
            try:
                data = _as_record(await self.fyers.quotes(symbols[i:i + 50]))
                quotes = data.get("d", data.get("quotes", []))
                all_quotes.extend(_records_from_value(quotes))
            except Exception as e:
                print("SCAN CHUNK ERROR:", e)

        return all_quotes

    async def _fetch_history(self, symbol: str, resolution: str, now: int) -> ScannerRecord:
        if not symbol:
            return {"s": "error", "code": 422, "message": "Missing symbol"}
        if self._invalid_until.get(symbol, 0) > time.monotonic():
            return {"s": "error", "code": 422, "message": "Temporarily skipped invalid symbol"}

        candle_seconds = _resolution_seconds(resolution)
        cache_key = (symbol, resolution, now // candle_seconds)
        cached = self._history_cache.get(cache_key)
        if cached is not None:
            return cached

        delay = 1.0
        for attempt in range(1, 4):
            await self._wait_for_history_slot()
            result = _as_record(await self.fyers.history(symbol=symbol, resolution=resolution, frm=now - (60 * 60 * 24 * 10), to=now))
            if result.get("code") == 429:
                if attempt == 3:
                    return result
                async with self._rate_lock:
                    self._global_backoff_until = max(
                        self._global_backoff_until,
                        time.monotonic() + delay + random.uniform(0.25, 0.75),
                    )
                delay *= 2
                continue
            if result.get("code") == 422:
                self._invalid_until[symbol] = time.monotonic() + 3600
                return result
            if result.get("s") == "ok":
                stale_keys = [
                    key for key in self._history_cache
                    if key[0] == symbol and key[1] == resolution and key != cache_key
                ]
                for key in stale_keys:
                    self._history_cache.pop(key, None)
                self._history_cache[cache_key] = result
            return result
        return {"s": "error", "code": 429, "message": "Too many requests"}

    async def _wait_for_history_slot(self) -> None:
        async with self._rate_lock:
            now = time.monotonic()
            wait_until = max(self._next_history_request_at, self._global_backoff_until)
            if wait_until > now:
                await asyncio.sleep(wait_until - now)
            self._next_history_request_at = time.monotonic() + 0.5 + random.uniform(0.02, 0.08)


def _symbols_for_universe(universe: str) -> List[str]:
    return NIFTY50[:50] if universe == "NIFTY50" else FNO


def _quote_block(record: ScannerRecord) -> ScannerRecord:
    value = record.get("v")
    return cast(ScannerRecord, value) if isinstance(value, dict) else {}


def _quote_number(record: ScannerRecord, *keys: str) -> float:
    v = _quote_block(record)
    for key in keys:
        if key in v:
            return _number(v, key)
        if key in record:
            return _number(record, key)
    return 0.0


def _quote_change_pct(record: ScannerRecord) -> float:
    explicit = _quote_number(record, "chp")
    if explicit:
        return explicit
    ltp = _quote_number(record, "lp", "ltp")
    prev_close = _quote_number(record, "prev_close_price", "prev_close")
    return ((ltp - prev_close) / max(prev_close, 1e-9)) * 100 if prev_close else 0.0


def _quote_rank(kind: str, quote: ScannerRecord) -> float:
    volume = max(0.0, _quote_number(quote, "volume", "vol_traded_today"))
    change = abs(_quote_change_pct(quote))
    ltp = _quote_number(quote, "lp", "ltp")
    day_high = _quote_number(quote, "high_price", "high")
    day_low = _quote_number(quote, "low_price", "low")
    liquidity_score = math.log10(volume + 1) * 4
    momentum_score = min(change, 10) * 4
    location_score = 0.0
    if kind in {"VWAP_BREAKOUT", "BREAKOUT_VOLUME", "BREAKOUT", "EMA_CROSS"} and ltp > 0 and day_high > 0:
        location_score = max(0.0, 20 * (1 - abs(day_high - ltp) / day_high))
    elif ltp > 0 and day_high > day_low > 0:
        location_score = abs(((ltp - day_low) / (day_high - day_low)) - 0.5) * 20
    return liquidity_score + momentum_score + location_score


def _prefilter_quotes(
    kind: str,
    params: ScannerRecord,
    quotes: List[ScannerRecord],
    limit: int = 40,
) -> List[ScannerRecord]:
    filtered = quotes
    if kind == "VOLUME_SPIKE":
        min_volume = _number(params, "minVolume", 1_000_000)
        filtered = [quote for quote in quotes if _quote_number(quote, "volume") > min_volume]
    elif kind == "OI_BREAKOUT":
        min_change = _number(params, "minChange", 3)
        filtered = [quote for quote in quotes if abs(_quote_change_pct(quote)) > min_change]
    ranked = sorted(filtered, key=lambda quote: _quote_rank(kind, quote), reverse=True)
    return ranked[:max(1, limit)]


def _resolution_seconds(resolution: str) -> int:
    try:
        minutes = max(1, int(resolution))
    except (TypeError, ValueError):
        minutes = 15
    return minutes * 60


def _signal_side(kind: str, ctx: ScannerRecord) -> str:
    if kind in {"GAP_DOWN_BREAK", "VWAP_REJECTION", "DEATH_CROSS"}:
        return "SELL"
    if kind in {"VOLUME_SPIKE", "OI_BREAKOUT", "INSIDE_BAR_BREAKOUT", "TREND_CONTINUATION"}:
        return "BUY" if _number(ctx, "chp") >= 0 else "SELL"
    return "BUY"


def _result_row(ctx: ScannerRecord, signal: str, side: str, scored: ScannerRecord) -> ScannerRecord:
    return {
        "symbol": _text(ctx, "symbol"),
        "side": side,
        "ltp": _number(ctx, "ltp"),
        "chp": round(_number(ctx, "chp"), 2),
        "volume": _number(ctx, "vol"),
        "signal": signal,
        "entry": round(_number(ctx, "ltp"), 2),
        "sl": round(_number(scored, "sl"), 2),
        "t1": round(_number(scored, "t1"), 2),
        "t2": round(_number(scored, "t2"), 2),
        "confidence": _number(scored, "confidence"),
        "factors": scored.get("factors", {}),
    }


def _dedupe(results: List[ScannerRecord]) -> List[ScannerRecord]:
    seen: Set[str] = set()
    unique: List[ScannerRecord] = []
    for row in results:
        symbol = _text(row, "symbol")
        if symbol in seen:
            continue
        seen.add(symbol)
        unique.append(row)
    return unique
