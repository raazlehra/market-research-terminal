from math import sqrt
from typing import Any


def _ema_series(values: list[float], period: int) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    if len(values) < period:
        return out
    value = sum(values[:period]) / period
    out[period - 1] = value
    multiplier = 2 / (period + 1)
    for index in range(period, len(values)):
        value = values[index] * multiplier + value * (1 - multiplier)
        out[index] = value
    return out


def _rsi(values: list[float], period: int = 14) -> float | None:
    if len(values) <= period:
        return None
    changes = [values[i] - values[i - 1] for i in range(1, len(values))]
    gain = sum(max(change, 0) for change in changes[:period]) / period
    loss = sum(max(-change, 0) for change in changes[:period]) / period
    for change in changes[period:]:
        gain = (gain * (period - 1) + max(change, 0)) / period
        loss = (loss * (period - 1) + max(-change, 0)) / period
    return 100.0 if loss == 0 else 100 - (100 / (1 + gain / loss))


def _atr(candles: list[dict[str, Any]], period: int = 14) -> float | None:
    if len(candles) <= period:
        return None
    ranges = []
    for index in range(1, len(candles)):
        row, previous = candles[index], candles[index - 1]
        ranges.append(max(row["high"] - row["low"], abs(row["high"] - previous["close"]), abs(row["low"] - previous["close"])))
    value = sum(ranges[:period]) / period
    for current in ranges[period:]:
        value = (value * (period - 1) + current) / period
    return value


def calculate_indicators(candles: list[dict[str, Any]]) -> dict[str, Any]:
    valid = [row for row in candles if all(isinstance(row.get(key), (int, float)) for key in ("open", "high", "low", "close", "volume"))]
    if not valid:
        return {"available": False, "reason": "No valid OHLCV candles were available."}
    closes = [float(row["close"]) for row in valid]
    volumes = [float(row["volume"]) for row in valid]
    ema20_series = _ema_series(closes, 20)
    ema50_series = _ema_series(closes, 50)
    ema12 = _ema_series(closes, 12)
    ema26 = _ema_series(closes, 26)
    macd_series = [a - b if a is not None and b is not None else None for a, b in zip(ema12, ema26)]
    macd_values = [value for value in macd_series if value is not None]
    signal_series = _ema_series(macd_values, 9)
    macd = macd_values[-1] if macd_values else None
    macd_signal = next((value for value in reversed(signal_series) if value is not None), None)
    window = closes[-20:]
    sma20 = sum(window) / len(window) if len(window) == 20 else None
    variance = sum((value - sma20) ** 2 for value in window) / 20 if sma20 is not None else None
    deviation = sqrt(variance) if variance is not None else None
    recent = valid[-20:]
    average_volume = sum(volumes[-21:-1]) / len(volumes[-21:-1]) if len(volumes) > 1 else 0
    volume_ratio = volumes[-1] / average_volume if average_volume > 0 else None
    price = closes[-1]
    ema20 = next((value for value in reversed(ema20_series) if value is not None), None)
    ema50 = next((value for value in reversed(ema50_series) if value is not None), None)
    trend = "UNAVAILABLE"
    if ema20 is not None and ema50 is not None:
        trend = "BULLISH" if price > ema20 > ema50 else "BEARISH" if price < ema20 < ema50 else "MIXED"
    atr = _atr(valid)
    return {
        "available": True,
        "price": round(price, 8),
        "sma20": round(sma20, 8) if sma20 is not None else None,
        "ema20": round(ema20, 8) if ema20 is not None else None,
        "ema50": round(ema50, 8) if ema50 is not None else None,
        "rsi14": round(_rsi(closes), 2) if _rsi(closes) is not None else None,
        "macd": round(macd, 8) if macd is not None else None,
        "macd_signal": round(macd_signal, 8) if macd_signal is not None else None,
        "bollinger_upper": round(sma20 + 2 * deviation, 8) if sma20 is not None and deviation is not None else None,
        "bollinger_lower": round(sma20 - 2 * deviation, 8) if sma20 is not None and deviation is not None else None,
        "atr14": round(atr, 8) if atr is not None else None,
        "support": round(min(float(row["low"]) for row in recent), 8),
        "resistance": round(max(float(row["high"]) for row in recent), 8),
        "volume_ratio": round(volume_ratio, 2) if volume_ratio is not None else None,
        "volume_condition": "ELEVATED" if volume_ratio is not None and volume_ratio >= 1.5 else "LIGHT" if volume_ratio is not None and volume_ratio < 0.7 else "NORMAL",
        "trend": trend,
        "candles": len(valid),
    }
