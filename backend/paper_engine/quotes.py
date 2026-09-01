from typing import Any, List, Optional, cast

from .types import FyersQuoteClient, PaperRecord


def _number(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def price_from_tick(tick: Optional[PaperRecord]) -> Optional[float]:
    if not tick:
        return None

    values_raw = tick.get("v")
    values = cast(PaperRecord, values_raw) if isinstance(values_raw, dict) else tick
    for key in ("ltp", "lp", "last_price", "ask", "ask_price", "bid", "bid_price"):
        price = _number(values.get(key))
        if price is not None:
            return price
    return None


def tick_from_quote_response(response: PaperRecord) -> Optional[PaperRecord]:
    if response.get("s") != "ok":
        return None

    data_raw: object = response.get("d", [])
    if not isinstance(data_raw, list) or not data_raw:
        return None

    data = cast(List[object], data_raw)
    quote_raw = data[0]
    if not isinstance(quote_raw, dict):
        return None
    quote = cast(PaperRecord, quote_raw)

    values_raw: Any = quote.get("v", {})
    if not isinstance(values_raw, dict):
        return None
    values = cast(PaperRecord, values_raw)

    ltp = price_from_tick(values)
    if ltp is None:
        return None

    bid = _number(values.get("bid") or values.get("bid_price"))
    ask = _number(values.get("ask") or values.get("ask_price"))
    return {"ltp": ltp, "bid": bid if bid is not None else ltp, "ask": ask if ask is not None else ltp}


def quote_tick(fyers_client: FyersQuoteClient, symbol: str, error_label: str) -> Optional[PaperRecord]:
    try:
        return tick_from_quote_response(fyers_client.quotes_sync([symbol]))
    except Exception as e:
        print(error_label, e)
        return None
