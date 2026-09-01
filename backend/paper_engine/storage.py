import json
from collections import defaultdict
from typing import Any, Dict, List, cast

from .records import float_value
from .types import BalanceMap, PaperLedger, PaperRecord


def as_record(value: Any) -> PaperRecord:
    return cast(PaperRecord, value) if isinstance(value, dict) else {}


def load_json_record(path: str) -> PaperRecord:
    with open(path, "r", encoding="utf-8") as f:
        return as_record(json.load(f))


def records_from_rows(value: object) -> List[PaperRecord]:
    if not isinstance(value, list):
        return []

    rows = cast(List[object], value)
    records: List[PaperRecord] = []
    for row in rows:
        if isinstance(row, dict):
            records.append(cast(PaperRecord, row))
    return records


def ledger_from_state(value: Any) -> PaperLedger:
    ledger: PaperLedger = defaultdict(list)
    if not isinstance(value, dict):
        return ledger

    raw_ledger = cast(Dict[object, object], value)
    for key, rows in raw_ledger.items():
        ledger[str(key)] = records_from_rows(rows)
    return ledger


def balances_from_state(value: Any) -> BalanceMap:
    balances: BalanceMap = {}
    if not isinstance(value, dict):
        return balances

    raw_balances = cast(Dict[object, object], value)
    for key, raw_balance in raw_balances.items():
        if isinstance(raw_balance, dict):
            balance = cast(Dict[str, object], raw_balance)
            balances[str(key)] = {
                "starting": float_value(balance.get("starting")),
                "available": float_value(balance.get("available")),
                "used": float_value(balance.get("used")),
            }
    return balances
