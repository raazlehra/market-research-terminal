from datetime import datetime, timezone
from typing import Annotated, Any, Optional, cast

from fastapi import Depends
from sqlalchemy.orm import Session

from .. import models
from ..state import db, get_market_user

PaperTradeOutcome = cast(Any, models.PaperTradeOutcome)
DbSession = Annotated[Session, Depends(db)]
MarketUser = Annotated[Any, Depends(get_market_user)]


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def number(value: Any, default: float = 0) -> float:
    try:
        return float(value if value is not None else default)
    except (TypeError, ValueError):
        return default


def text(value: Any, default: str = "") -> str:
    return str(value if value is not None else default)


def payload_float(payload: dict[str, Any], key: str) -> Optional[float]:
    value = payload.get(key)
    return float(value) if value is not None else None


def payload_optional_number(payload: dict[str, Any], key: str) -> float | None:
    value = payload.get(key)
    return number(value) if value is not None else None


def payload_time(value: Any) -> datetime:
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return utcnow()
    return utcnow()


def attr(row: Any, name: str, default: Any = None) -> Any:
    return getattr(row, name, default)


def row_float(row: Any, name: str) -> float:
    return number(attr(row, name))


def row_bool(row: Any, name: str) -> bool:
    return bool(attr(row, name, False))


def serialize_paper_outcome(outcome: Any) -> dict[str, Any]:
    signal_time = attr(outcome, "signal_time")
    created_at = attr(outcome, "created_at")
    updated_at = attr(outcome, "updated_at")
    return {
        "id": str(attr(outcome, "id")),
        "orderId": attr(outcome, "order_id"),
        "signalTime": signal_time.isoformat() if signal_time else None,
        "symbol": attr(outcome, "symbol"),
        "side": attr(outcome, "side"),
        "qty": attr(outcome, "qty"),
        "strategy": attr(outcome, "strategy"),
        "confidence": attr(outcome, "confidence"),
        "entry": attr(outcome, "entry"),
        "sl": attr(outcome, "sl"),
        "t1": attr(outcome, "t1"),
        "t2": attr(outcome, "t2"),
        "slHit": attr(outcome, "sl_hit"),
        "t1Hit": attr(outcome, "t1_hit"),
        "t2Hit": attr(outcome, "t2_hit"),
        "closed": attr(outcome, "closed"),
        "pnl": attr(outcome, "pnl"),
        "notes": attr(outcome, "notes"),
        "createdAt": created_at.isoformat() if created_at else None,
        "updatedAt": updated_at.isoformat() if updated_at else None,
    }
