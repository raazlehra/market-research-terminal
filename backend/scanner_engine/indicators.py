import time
from datetime import datetime
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

_IST = ZoneInfo("Asia/Kolkata")
_SUPPORTED_RESOLUTION_SECONDS = {
    "1": 60,
    "5": 300,
    "15": 900,
    "60": 3600,
    "D": 86400,
}
_MARKET_CLOSE_HOUR = 15
_MARKET_CLOSE_MINUTE = 30


def ema(closes: list[float], period: int) -> float:
    value = closes[0]
    multiplier = 2 / (period + 1)
    for price in closes[1:]:
        value = price * multiplier + value * (1 - multiplier)
    return value


def atr(candles: list[list[Any]], period: int = 14) -> float:
    ranges = []
    for i in range(1, len(candles)):
        prev_close = float(candles[i - 1][4])
        high = float(candles[i][2])
        low = float(candles[i][3])
        ranges.append(max(high - low, abs(high - prev_close), abs(low - prev_close)))
    recent = ranges[-period:]
    return sum(recent) / len(recent) if recent else 0


def build_context(
    quote: Dict[str, Any],
    history: Dict[str, Any],
    resolution: str = "15",
    now: int | None = None,
) -> Optional[Dict[str, Any]]:
    candles = _completed_candles(history.get("candles", []), resolution, now)
    if not candles or len(candles) < 50:
        return None

    last20 = candles[-20:]
    closes = [float(c[4]) for c in candles]
    volumes = [float(c[5] or 0) for c in candles]
    if not closes:
        return None

    close = closes[-1]
    day_high = max(float(c[2]) for c in last20)
    prev_high = max(float(c[2]) for c in candles[-21:-1])
    day_low = min(float(c[3]) for c in last20)
    avg_volume = sum(volumes[-20:]) / 20
    current_volume = volumes[-1]
    vwap = _vwap(candles[-50:], close)
    v_block = quote.get("v", {}) if isinstance(quote.get("v"), dict) else {}
    ltp = v_block.get("lp") or quote.get("ltp", 0)
    pc = v_block.get("prev_close_price") or v_block.get("prev_close") or quote.get("prev_close_price", 0)
    vol = v_block.get("volume") or quote.get("volume", 0)
    if not ltp:
        return None

    last_candle = candles[-1]
    open_price = float(last_candle[1])
    high_price = float(last_candle[2])
    low_price = float(last_candle[3])
    candle_range = high_price - low_price
    body = abs(close - open_price)
    body_pct = body / candle_range if candle_range else 0
    upper_wick = high_price - max(open_price, close)
    upper_wick_pct = upper_wick / candle_range if candle_range else 0
    close_high_pct = (high_price - close) / candle_range if candle_range else 1

    return {
        "symbol": quote.get("n") or quote.get("symbol"),
        "close": close,
        "day_high": day_high,
        "prev_high": prev_high,
        "day_low": day_low,
        "avg_volume": avg_volume,
        "current_volume": current_volume,
        "ema20": ema(closes, 20),
        "ema50": ema(closes, 50),
        "vwap": vwap,
        "atr": atr(candles),
        "ltp": ltp,
        "pc": pc,
        "vol": vol,
        "chp": ((ltp - pc) / max(pc, 1e-9)) * 100 if pc else 0,
        "strong_candle": body_pct >= 0.5 and close_high_pct <= 0.18 and upper_wick_pct <= 0.25,
    }


def _vwap(candles: list[list[Any]], fallback: float) -> float:
    pv = 0.0
    tv = 0.0
    for candle in candles:
        price = float(candle[4])
        vol = float(candle[5] or 0)
        pv += price * vol
        tv += vol
    return pv / tv if tv else fallback


def _completed_candles(raw: Any, resolution: str = "15", now: int | None = None) -> list[list[float]]:
    if not isinstance(raw, list):
        return []
    timeframe_seconds = _resolution_seconds(resolution)
    if timeframe_seconds is None:
        return []
    current_time = int(time.time()) if now is None else int(now)
    by_timestamp: dict[int, list[float]] = {}
    for candle in raw:
        if not isinstance(candle, (list, tuple)) or len(candle) < 6:
            continue
        try:
            ts = _normalize_timestamp(candle[0])
            values = [float(ts), *[float(value or 0) for value in candle[1:6]]]
        except (TypeError, ValueError):
            continue
        high = values[2]
        low = values[3]
        close = values[4]
        if ts <= 0 or high < low or close <= 0:
            continue
        completion_time = _candle_completion_time(ts, resolution, timeframe_seconds)
        if completion_time is None or completion_time > current_time:
            continue
        by_timestamp[ts] = values
    return [by_timestamp[ts] for ts in sorted(by_timestamp)]


def _resolution_seconds(resolution: str) -> int | None:
    return _SUPPORTED_RESOLUTION_SECONDS.get(str(resolution).strip().upper())


def _normalize_timestamp(value: Any) -> int:
    timestamp = float(value)
    if timestamp >= 10_000_000_000:
        timestamp /= 1000
    return int(timestamp)


def _candle_completion_time(ts: int, resolution: str, timeframe_seconds: int) -> int | None:
    if str(resolution).strip().upper() != "D":
        return ts + timeframe_seconds

    candle_date = datetime.fromtimestamp(ts, _IST)
    if candle_date.weekday() >= 5:
        return None
    session_close = candle_date.replace(
        hour=_MARKET_CLOSE_HOUR,
        minute=_MARKET_CLOSE_MINUTE,
        second=0,
        microsecond=0,
    )
    return int(session_close.timestamp())
