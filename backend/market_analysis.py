import asyncio
import time
from datetime import datetime
from typing import Any, Awaitable, Callable
from zoneinfo import ZoneInfo

HistoryFetcher = Callable[..., Awaitable[dict[str, Any]]]

_CACHE_SECONDS = 30.0
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_locks: dict[str, asyncio.Lock] = {}
_IST = ZoneInfo("Asia/Kolkata")

TIMEFRAMES = {
    "5": {"days": 7, "seconds": 300},
    "15": {"days": 14, "seconds": 900},
    "60": {"days": 60, "seconds": 3600},
}


def _number(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _completed_candles(raw: Any, timeframe_seconds: int, now: int) -> list[list[float]]:
    if not isinstance(raw, list):
        return []
    rows: list[list[float]] = []
    for candle in raw:
        if not isinstance(candle, (list, tuple)) or len(candle) < 6:
            continue
        ts = int(_number(candle[0]))
        values = [float(ts), *[_number(value) for value in candle[1:6]]]
        if ts > 0 and values[2] >= values[3] and values[4] > 0 and ts + timeframe_seconds <= now:
            rows.append(values)
    rows.sort(key=lambda row: row[0])
    return rows


def _ema(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    seed = sum(values[:period]) / period
    multiplier = 2 / (period + 1)
    result = seed
    for value in values[period:]:
        result = value * multiplier + result * (1 - multiplier)
    return round(result, 2)


def _rsi(values: list[float], period: int = 14) -> float | None:
    if len(values) <= period:
        return None
    changes = [values[index] - values[index - 1] for index in range(1, len(values))]
    gains = [max(change, 0) for change in changes]
    losses = [max(-change, 0) for change in changes]
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for gain, loss in zip(gains[period:], losses[period:]):
        avg_gain = ((avg_gain * (period - 1)) + gain) / period
        avg_loss = ((avg_loss * (period - 1)) + loss) / period
    if avg_loss == 0:
        return 100.0
    return round(100 - (100 / (1 + avg_gain / avg_loss)), 2)


def _atr(rows: list[list[float]], period: int = 14) -> float | None:
    if len(rows) <= period:
        return None
    ranges: list[float] = []
    for index in range(1, len(rows)):
        high, low, previous_close = rows[index][2], rows[index][3], rows[index - 1][4]
        ranges.append(max(high - low, abs(high - previous_close), abs(low - previous_close)))
    value = sum(ranges[:period]) / period
    for current in ranges[period:]:
        value = ((value * (period - 1)) + current) / period
    return round(value, 2)


def _timeframe_snapshot(rows: list[list[float]], seconds: int, now: int) -> dict[str, Any]:
    if not rows:
        return {
            "available": False, "candles": 0, "fresh": False, "vwap": None,
            "ema20": None, "ema50": None, "rsi14": None, "atr14": None,
            "support": None, "resistance": None, "direction": "UNKNOWN",
            "candle_direction": "neutral", "candle_confirmed": False,
            "volume_ratio": None, "last_candle_ts": None,
        }

    closes = [row[4] for row in rows]
    latest_date = datetime.fromtimestamp(rows[-1][0], _IST).date()
    session = [row for row in rows if datetime.fromtimestamp(row[0], _IST).date() == latest_date]
    cumulative_volume = sum(max(0, row[5]) for row in session)
    vwap = (
        sum(((row[2] + row[3] + row[4]) / 3) * max(0, row[5]) for row in session) / cumulative_volume
        if cumulative_volume > 0 else None
    )
    ema20 = _ema(closes, 20)
    ema50 = _ema(closes, 50)
    rsi14 = _rsi(closes)
    atr14 = _atr(rows)
    last = rows[-1]
    recent = rows[-20:]
    volumes = [row[5] for row in rows[-21:-1] if row[5] > 0]
    average_volume = sum(volumes) / len(volumes) if volumes else 0
    volume_ratio = last[5] / average_volume if average_volume > 0 else None
    body = abs(last[4] - last[1])
    candle_range = max(last[2] - last[3], 0.0001)
    candle_direction = "bullish" if last[4] > last[1] else "bearish" if last[4] < last[1] else "neutral"
    candle_confirmed = body / candle_range >= 0.55 and (volume_ratio is None or volume_ratio >= 1.0)
    direction = "UNKNOWN"
    if vwap and ema20 and ema50:
        if last[4] > vwap and last[4] > ema20 > ema50:
            direction = "BULLISH"
        elif last[4] < vwap and last[4] < ema20 < ema50:
            direction = "BEARISH"
        else:
            direction = "MIXED"

    return {
        "available": bool(vwap and ema20 and ema50 and rsi14 is not None),
        "candles": len(rows),
        "fresh": now - int(last[0]) <= max(seconds * 3, 900),
        "vwap": round(vwap, 2) if vwap else None,
        "ema20": ema20,
        "ema50": ema50,
        "rsi14": rsi14,
        "atr14": atr14,
        "support": round(min(row[3] for row in recent), 2),
        "resistance": round(max(row[2] for row in recent), 2),
        "direction": direction,
        "candle_direction": candle_direction,
        "candle_confirmed": candle_confirmed,
        "volume_ratio": round(volume_ratio, 2) if volume_ratio is not None else None,
        "last_candle_ts": int(last[0]),
    }


def _overall(timeframes: dict[str, dict[str, Any]]) -> dict[str, Any]:
    directions = [timeframes[key]["direction"] for key in ("5", "15", "60")]
    bullish = directions.count("BULLISH")
    bearish = directions.count("BEARISH")
    direction = "BULLISH" if bullish >= 2 else "BEARISH" if bearish >= 2 else "MIXED"
    available = sum(bool(timeframes[key]["available"]) for key in ("5", "15", "60"))
    aligned = max(bullish, bearish)
    score = round((available / 3) * 40 + (aligned / 3) * 40)
    primary = timeframes["5"]
    rsi = primary.get("rsi14")
    if direction == "BULLISH" and isinstance(rsi, (int, float)) and 50 <= rsi <= 70:
        score += 10
    elif direction == "BEARISH" and isinstance(rsi, (int, float)) and 30 <= rsi <= 50:
        score += 10
    if primary.get("candle_confirmed") and primary.get("candle_direction", "").upper() == direction:
        score += 10
    return {
        "direction": direction,
        "score": min(100, score),
        "timeframes_available": available,
        "aligned_timeframes": aligned,
        "fresh": bool(primary.get("fresh")),
    }


async def get_market_analysis(history: HistoryFetcher, symbol: str) -> dict[str, Any]:
    cached = _cache.get(symbol)
    if cached and time.monotonic() - cached[0] < _CACHE_SECONDS:
        return cached[1]
    lock = _locks.setdefault(symbol, asyncio.Lock())
    async with lock:
        cached = _cache.get(symbol)
        if cached and time.monotonic() - cached[0] < _CACHE_SECONDS:
            return cached[1]
        now = int(time.time())

        async def fetch(resolution: str) -> tuple[str, dict[str, Any]]:
            config = TIMEFRAMES[resolution]
            response = await history(
                symbol=symbol,
                resolution=resolution,
                frm=now - config["days"] * 86400,
                to=now,
            )
            rows = _completed_candles(response.get("candles", []), config["seconds"], now)
            return resolution, _timeframe_snapshot(rows, config["seconds"], now)

        fetched = await asyncio.gather(*(fetch(resolution) for resolution in TIMEFRAMES))
        timeframes = dict(fetched)
        result = {
            "symbol": symbol,
            "generated_at": now,
            "timeframes": timeframes,
            "overall": _overall(timeframes),
        }
        _cache[symbol] = (time.monotonic(), result)
        return result
