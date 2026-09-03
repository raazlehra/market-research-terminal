from typing import Any, Dict, Literal

ScoreDirection = Literal["bullish", "bearish", "neutral"]


SCORE_TYPE = "rule_based_confluence"
SCORE_RANGE = [25, 95]


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

    intended_direction = _intended_direction(side)
    trend_component = _trend_component(close, vwap, ema20, ema50, intended_direction)
    trend_score = trend_component["pointsContributed"]
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

    breakdown = [
        trend_component,
        _component("volume", current_volume / max(avg_volume, 1), volume_score, 20, intended_direction, False, "Volume relative to the recent average."),
        _component("momentum", abs(chp), momentum_score, 15, intended_direction, False, "Absolute intraday percentage change."),
        _component("support", close, support_score, 15, intended_direction, False, "Distance from recent high or low."),
        _component("rr", None, rr_score, 10, intended_direction, False, "Reward-to-risk from generated stop and targets."),
        _component("range", close, range_score, 10, intended_direction, False, "Location inside the recent trading range."),
    ]
    if penalty:
        breakdown.append(_component("penalty", penalty, -abs(penalty), 0, intended_direction, False, "Signal-quality penalty from scanner strategy filters."))

    return {
        **levels,
        "confidence": confidence,
        "scoreType": SCORE_TYPE,
        "calibrated": False,
        "scoreRange": SCORE_RANGE,
        "intendedSide": intended_direction,
        "factors": {
            "trend": round(trend_score, 1),
            "volume": round(volume_score, 1),
            "momentum": round(momentum_score, 1),
            "support": round(support_score, 1),
            "rr": round(rr_score, 1),
            "range": round(range_score, 1),
        },
        "breakdown": breakdown,
    }


def _intended_direction(side: str) -> ScoreDirection:
    normalized = str(side or "").upper()
    if normalized == "BUY":
        return "bullish"
    if normalized == "SELL":
        return "bearish"
    return "neutral"


def _trend_direction(close: float, vwap: float, ema20: float, ema50: float) -> ScoreDirection:
    bullish = close > vwap and ema20 > ema50 and close > ema20 > ema50
    bearish = close < vwap and ema20 < ema50 and close < ema20 < ema50
    if bullish:
        return "bullish"
    if bearish:
        return "bearish"
    return "neutral"


def _trend_component(close: float, vwap: float, ema20: float, ema50: float, intended: ScoreDirection) -> Dict[str, Any]:
    if intended == "neutral":
        return _component("trend", None, 0, 25, "neutral", True, "No directional side was supplied for trend scoring.")

    actual = _trend_direction(close, vwap, ema20, ema50)
    supports = {
        "bullish": [
            (close > vwap and ema20 > ema50 and close > ema20 > ema50, 25, "Price, VWAP, EMA20, and EMA50 are bullishly aligned."),
            (close > vwap and ema20 > ema50, 20, "Price is above VWAP and EMA20 is above EMA50."),
            (close > vwap, 12, "Price is above VWAP."),
            (close > ema20, 8, "Price is above EMA20."),
            (close > ema50, 5, "Price is above EMA50."),
        ],
        "bearish": [
            (close < vwap and ema20 < ema50 and close < ema20 < ema50, 25, "Price, VWAP, EMA20, and EMA50 are bearishly aligned."),
            (close < vwap and ema20 < ema50, 20, "Price is below VWAP and EMA20 is below EMA50."),
            (close < vwap, 12, "Price is below VWAP."),
            (close < ema20, 8, "Price is below EMA20."),
            (close < ema50, 5, "Price is below EMA50."),
        ],
    }
    for matched, points, reason in supports[intended]:
        if matched:
            return _component("trend", actual, points, 25, intended, False, reason)

    opposite: ScoreDirection = "bearish" if intended == "bullish" else "bullish"
    for matched, points, reason in supports[opposite]:
        if matched:
            return _component(
                "trend",
                actual,
                -min(10, points),
                25,
                opposite,
                False,
                f"Contradictory {opposite} alignment for a {intended} signal: {reason}",
            )

    return _component("trend", actual, 0, 25, "neutral", False, "Trend inputs are mixed or flat.")


def _component(
    name: str,
    raw_value: Any,
    points: float,
    weight: float,
    direction: ScoreDirection,
    missing: bool,
    reason: str,
) -> Dict[str, Any]:
    normalized = 0 if not weight else max(-1, min(1, points / weight))
    return {
        "component": name,
        "rawValue": raw_value,
        "normalizedValue": round(normalized, 4),
        "weight": weight,
        "pointsContributed": round(points, 2),
        "direction": direction,
        "missingData": missing,
        "reason": reason,
    }


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
