from typing import Any, Dict, Optional


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


def build_context(quote: Dict[str, Any], history: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    candles = history.get("candles", [])
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
