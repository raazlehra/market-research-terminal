from typing import Iterable, List


SYMBOL_ALIASES = {
    "NSE:ZOMATO-EQ": "NSE:ETERNAL-EQ",
}


def normalize_symbol(symbol: str) -> str:
    normalized = str(symbol or "").strip().upper()
    return SYMBOL_ALIASES.get(normalized, normalized)


def normalize_symbols(symbols: Iterable[str]) -> List[str]:
    return [normalize_symbol(symbol) for symbol in symbols]
