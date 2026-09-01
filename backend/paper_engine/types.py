from collections import defaultdict
from typing import Any, DefaultDict, Dict, List, Optional, Protocol

PaperRecord = Dict[str, Any]
PaperLedger = DefaultDict[str, List[PaperRecord]]
BalanceMap = Dict[str, Dict[str, float]]


class FyersQuoteClient(Protocol):
    def get_tick(self, symbol: str) -> Optional[PaperRecord]:
        ...

    def quotes_sync(self, symbols: List[str]) -> PaperRecord:
        ...


def empty_ledger() -> PaperLedger:
    return defaultdict(list)
