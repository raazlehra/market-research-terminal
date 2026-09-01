from typing import Any

from .types import PaperRecord


def int_value(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def float_value(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def open_qty(record: PaperRecord) -> int:
    return int_value(record.get("openQty", record.get("qty", 0)))
