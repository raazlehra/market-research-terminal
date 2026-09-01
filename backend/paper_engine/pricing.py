from datetime import datetime
from zoneinfo import ZoneInfo

BROKERAGE_FLAT = 20.0
BROKERAGE_PCT = 0.0003
STT_PCT = 0.000625
EXCH_PCT = 0.00051
GST_PCT = 0.18
SEBI_PCT = 0.000001
STAMP_PCT = 0.00003
DERIVATIVE_MARGIN_PCT = 0.2


def charges(price: float, qty: int, side: str) -> float:
    turnover = price * qty
    brokerage = min(BROKERAGE_FLAT, turnover * BROKERAGE_PCT)
    stt = STT_PCT * turnover if side == "SELL" else 0
    exch = EXCH_PCT * turnover
    sebi = SEBI_PCT * turnover
    stamp = STAMP_PCT * turnover if side == "BUY" else 0
    gst = GST_PCT * (brokerage + exch)
    return round(brokerage + stt + exch + sebi + stamp + gst, 2)


def is_option_symbol(symbol: str) -> bool:
    normalized = symbol.upper()
    if normalized.endswith("-EQ"):
        return False
    return normalized.endswith(("CE", "PE")) or "CALL" in normalized or "PUT" in normalized


def is_cash_equity_symbol(symbol: str) -> bool:
    return symbol.upper().endswith("-EQ")


def capital_required(symbol: str, price: float, qty: int) -> float:
    notional = price * qty
    if is_cash_equity_symbol(symbol) or is_option_symbol(symbol):
        return notional
    return notional * DERIVATIVE_MARGIN_PCT


def same_direction(a: int, b: int) -> bool:
    return (a > 0 and b > 0) or (a < 0 and b < 0)


def market_open() -> bool:
    now = datetime.now(ZoneInfo("Asia/Kolkata"))

    if now.weekday() >= 5:
        return False

    holidays = {
        "2026-03-04",
        "2026-05-28",
    }
    if now.strftime("%Y-%m-%d") in holidays:
        return False

    start = now.replace(hour=9, minute=15, second=0, microsecond=0)
    end = now.replace(hour=15, minute=30, second=0, microsecond=0)
    return start <= now <= end
