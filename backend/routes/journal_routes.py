import json
from typing import Any

from fastapi import APIRouter, HTTPException

from .. import models
from .common import CurrentUser, DbSession, json_list, utcnow

router = APIRouter()


@router.get("/api/journal")
def list_journal(d: DbSession, u: CurrentUser, user_id: str | None = None) -> list[dict[str, Any]]:
    entries = d.query(models.JournalEntry).filter_by(user_id=u.id).order_by(models.JournalEntry.created_at.desc()).all()
    return [
        {
            "id": str(e.id),
            "date": e.date.isoformat() if e.date else None,
            "createdAt": e.created_at.isoformat(),
            "symbol": e.symbol,
            "side": e.side,
            "qty": e.qty,
            "entry": e.entry,
            "exit": e.exit,
            "pnl": e.pnl,
            "strategy": e.strategy,
            "tags": json_list(e.tags),
            "notes": e.notes,
        }
        for e in entries
    ]


@router.post("/api/journal")
def create_journal(payload: dict[str, Any], d: DbSession, u: CurrentUser) -> dict[str, str]:
    entry = models.JournalEntry(
        user_id=u.id,
        symbol=payload.get("symbol"),
        side=payload.get("side"),
        qty=payload.get("qty"),
        entry=payload.get("entry"),
        exit=payload.get("exit"),
        pnl=payload.get("pnl"),
        strategy=payload.get("strategy"),
        tags=json.dumps(payload.get("tags", [])),
        notes=payload.get("notes"),
        date=utcnow(),
    )
    d.add(entry)
    d.commit()
    return {"id": str(entry.id)}


@router.patch("/api/journal/{entry_id}")
def update_journal(entry_id: str, payload: dict[str, Any], d: DbSession, u: CurrentUser) -> dict[str, bool]:
    entry = d.query(models.JournalEntry).filter_by(id=entry_id, user_id=u.id).first()
    if not entry:
        raise HTTPException(404)
    for key, value in payload.items():
        setattr(entry, key, value)
    d.commit()
    return {"ok": True}


@router.delete("/api/journal/{entry_id}")
def delete_journal(entry_id: str, d: DbSession, u: CurrentUser) -> dict[str, bool]:
    entry = d.query(models.JournalEntry).filter_by(id=entry_id, user_id=u.id).first()
    if entry:
        d.delete(entry)
        d.commit()
    return {"ok": True}
