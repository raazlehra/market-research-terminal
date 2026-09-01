from typing import Any, Dict


def score_context(ctx: Dict[str, Any], penalty: int, side: str = "BUY") -> Dict[str, Any]:
    close = ctx["close"]
    vwap = ctx["vwap"]
    ema20 = ctx["ema20"]
    ema50 = ctx["ema50"]
    avg_volume = ctx["avg_volume"]
    current_volume = ctx["current_volume"]
    chp = ctx["chp"]
    day_high = ctx["day_high"]
    day_low = ctx["day_low"]
    atr = ctx["atr"]

    trend_score = _trend_score(close, vwap, ema20, ema50)
    volume_score = _volume_score(current_volume / max(avg_volume, 1))
    momentum_score = _momentum_score(abs(chp))
    support_score = _support_score(close, day_high, day_low)
    levels = _levels(close, side, atr)
    rr_score = _rr_score(close, levels["sl"], levels["t1"], levels["t2"])
    range_score = _range_score(close, day_high, day_low, side)

    confidence = 30 + trend_score + volume_score + momentum_score + support_score + rr_score + range_score
    if penalty:
        confidence = max(confidence - penalty, 25)
    confidence = max(min(confidence, 95), 25)

    return {
        **levels,
        "confidence": confidence,
        "factors": {
            "trend": round(trend_score, 1),
            "volume": round(volume_score, 1),
            "momentum": round(momentum_score, 1),
            "support": round(support_score, 1),
            "rr": round(rr_score, 1),
            "range": round(range_score, 1),
        },
    }


def _trend_score(close: float, vwap: float, ema20: float, ema50: float) -> int:
    bullish = close > vwap and ema20 > ema50 and close > ema20 > ema50
    bearish = close < vwap and ema20 < ema50 and close < ema20 < ema50
    if bullish or bearish:
        return 25
    if (close > vwap and ema20 > ema50) or (close < vwap and ema20 < ema50):
        return 20
    if close > vwap or close < vwap:
        return 12
    if close > ema20 or close < ema20:
        return 8
    if close > ema50 or close < ema50:
        return 5
    return 0


def _volume_score(ratio: float) -> int:
    if ratio > 2.0:
        return 20
    if ratio > 1.5:
        return 15
    if ratio > 1.2:
        return 10
    if ratio > 0.8:
        return 5
    return 0


def _momentum_score(abs_chp: float) -> int:
    if abs_chp > 3:
        return 15
    if abs_chp > 2:
        return 12
    if abs_chp > 1:
        return 8
    if abs_chp > 0.5:
        return 4
    return 0


def _support_score(close: float, day_high: float, day_low: float) -> int:
    span = day_high - day_low
    if day_high - close < span * 0.05 or close - day_low < span * 0.05:
        return 15
    if day_high - close < span * 0.15 or close - day_low < span * 0.15:
        return 10
    return 5


def _levels(entry: float, side: str, atr: float) -> Dict[str, float]:
    if side == "BUY":
        return {"sl": entry - (1.5 * atr), "t1": entry + (2 * atr), "t2": entry + (4 * atr)}
    return {"sl": entry + (1.5 * atr), "t1": entry - (2 * atr), "t2": entry - (4 * atr)}


def _rr_score(entry: float, sl: float, t1: float, t2: float) -> int:
    risk = abs(entry - sl)
    reward = max(abs(t1 - entry), abs(t2 - entry))
    if risk <= 0:
        return 0
    rr = reward / risk
    if rr > 4:
        return 10
    if rr > 3:
        return 9
    if rr > 2.5:
        return 8
    if rr > 2:
        return 6
    if rr > 1.5:
        return 4
    return 2


def _range_score(close: float, day_high: float, day_low: float, side: str) -> int:
    position = (close - day_low) / max(day_high - day_low, 1)
    if side == "BUY":
        if position > 0.7:
            return 10
        if position > 0.5:
            return 7
        if position > 0.3:
            return 4
    else:
        if position < 0.3:
            return 10
        if position < 0.5:
            return 7
        if position < 0.7:
            return 4
    return 0
