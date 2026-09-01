import json
from typing import Any, cast

from fastapi import APIRouter

from .. import models
from .common import CurrentUser, DbSession

router = APIRouter()

BOT_DECISION_STATUSES = ("CHECK", "TRADE", "SKIP", "BLOCKED", "ERROR")
BOT_DECISION_SOURCES = ("scanner", "tick", "option_chain")


def _clamp_number(value: Any, default: float, minimum: float, maximum: float) -> float:
    try:
        parsed = float(value)
    except Exception:
        return default
    return max(minimum, min(parsed, maximum))


def _clean_optional_text(value: Any, max_len: int = 240) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:max_len]


def _sanitize_bot_decision(payload: dict[str, Any]) -> dict[str, Any]:
    raw_status = str(payload.get("status") or "CHECK").upper()
    status = raw_status if raw_status in BOT_DECISION_STATUSES else "CHECK"
    raw_source = payload.get("source")
    source = str(raw_source) if raw_source in BOT_DECISION_SOURCES else None
    raw_confidence = payload.get("confidence")
    confidence = _clamp_number(raw_confidence, 0, 0, 100) if raw_confidence is not None else None
    raw_details = payload.get("details")
    details = raw_details if isinstance(raw_details, dict) else None
    return {
        "status": status,
        "message": str(payload.get("message") or "").strip()[:1000],
        "symbol": _clean_optional_text(payload.get("symbol"), 120),
        "side": _clean_optional_text(payload.get("side"), 12),
        "confidence": confidence,
        "strategy": _clean_optional_text(payload.get("strategy"), 120),
        "source": source,
        "details_json": json.dumps(details) if details is not None else None,
    }


def _bot_decision_to_dict(row: models.BotDecision) -> dict[str, Any]:
    details: dict[str, Any] | None = None
    if row.details_json:
        try:
            parsed = json.loads(row.details_json)
            details = cast(dict[str, Any], parsed) if isinstance(parsed, dict) else None
        except Exception:
            details = None
    return {
        "id": str(row.id),
        "time": row.created_at.isoformat(),
        "status": row.status,
        "message": row.message,
        "symbol": row.symbol,
        "side": row.side,
        "confidence": row.confidence,
        "strategy": row.strategy,
        "source": row.source,
        "details": details,
    }


@router.get("/api/bot-decisions")
def list_bot_decisions(d: DbSession, u: CurrentUser, limit: int = 50) -> list[dict[str, Any]]:
    capped_limit = max(1, min(int(limit), 200))
    rows = (
        d.query(models.BotDecision)
        .filter_by(user_id=u.id)
        .order_by(models.BotDecision.created_at.desc())
        .limit(capped_limit)
        .all()
    )
    return [_bot_decision_to_dict(row) for row in rows]


@router.post("/api/bot-decisions")
def create_bot_decision(payload: dict[str, Any], d: DbSession, u: CurrentUser) -> dict[str, Any]:
    cleaned = _sanitize_bot_decision(payload)
    row = models.BotDecision(user_id=u.id, **cleaned)
    d.add(row)
    d.commit()
    d.refresh(row)
    return _bot_decision_to_dict(row)


@router.delete("/api/bot-decisions")
def clear_bot_decisions(d: DbSession, u: CurrentUser) -> dict[str, bool]:
    d.query(models.BotDecision).filter_by(user_id=u.id).delete()
    d.commit()
    return {"ok": True}
