from typing import Any, Dict, Optional, Tuple


def detect_signal(kind: str, params: Dict[str, Any], ctx: Dict[str, Any]) -> Tuple[Optional[str], int]:
    close = ctx["close"]
    prev_high = ctx["prev_high"]
    day_high = ctx["day_high"]
    avg_volume = ctx["avg_volume"]
    current_volume = ctx["current_volume"]
    ema20 = ctx["ema20"]
    ema50 = ctx["ema50"]
    vwap = ctx["vwap"]
    chp = ctx["chp"]
    vol = ctx["vol"]
    strong_candle = ctx["strong_candle"]
    penalty = 0

    if kind == "OI_BREAKOUT":
        return ("OI breakout" if abs(chp) > params.get("minChange", 3) else None), penalty
    if kind == "VOLUME_SPIKE":
        return ("Volume spike" if vol > params.get("minVolume", 1_000_000) else None), penalty
    if kind == "BREAKOUT_VOLUME" and close > prev_high and current_volume > avg_volume * 2:
        return "Breakout Volume", 0 if strong_candle else 12
    if kind == "BREAKOUT" and close > prev_high and current_volume > avg_volume * 1.5:
        return "Price breakout", 0 if strong_candle else 10
    if kind == "EMA_CROSS":
        return ("EMA Cross" if close > ema20 > ema50 else None), penalty
    if kind == "VWAP_BREAKOUT":
        return ("VWAP Breakout" if close > vwap and current_volume > avg_volume * 1.5 and strong_candle else None), penalty
    if kind == "PULLBACK_BUY":
        return ("Pullback Buy" if chp > 1 else None), penalty
    if kind == "GAP_UP_SUSTAIN":
        return ("Gap Up" if chp > 0.5 else None), penalty
    if kind == "GAP_DOWN_BREAK":
        return ("Gap Down" if chp < -0.5 else None), penalty
    if kind == "VWAP_REJECTION":
        return ("VWAP Rejection" if -1.5 < chp < -0.5 else None), penalty
    if kind == "EMA_PULLBACK":
        return ("EMA Pullback" if 0.5 < chp < 1.5 else None), penalty
    if kind == "GOLDEN_CROSSOVER":
        return ("Golden Cross" if chp > 0.5 else None), penalty
    if kind == "DEATH_CROSS":
        return ("Death Cross" if chp < -0.5 else None), penalty
    if kind == "INSIDE_BAR_BREAKOUT":
        return ("Inside Bar" if 1 < abs(chp) < 2 else None), penalty
    if kind == "RANGE_BREAKOUT":
        return ("Range Breakout" if close > day_high * 0.998 else None), penalty
    if kind == "TREND_CONTINUATION":
        return ("Trend Continuation" if abs(chp) > 3 else None), penalty

    return None, penalty
