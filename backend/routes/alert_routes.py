from typing import Any

from fastapi import APIRouter

from .. import models
from .common import CurrentUser, DbSession

router = APIRouter()


@router.get("/api/alerts")
def list_alerts(d: DbSession, u: CurrentUser) -> list[dict[str, Any]]:
    return [
        {
            "id": str(alert.id),
            "symbol": alert.symbol,
            "type": alert.type,
            "value": alert.value,
            "triggered": alert.triggered,
            "lastFiredAt": alert.last_fired_at.isoformat() if alert.last_fired_at else None,
            "webhook": alert.webhook,
        }
        for alert in d.query(models.Alert).filter_by(user_id=u.id).all()
    ]


@router.post("/api/alerts")
def create_alert(payload: dict[str, Any], d: DbSession, u: CurrentUser) -> dict[str, str]:
    alert = models.Alert(
        user_id=u.id,
        symbol=payload["symbol"],
        type=payload["type"],
        value=payload.get("value"),
        webhook=payload.get("webhook"),
    )
    d.add(alert)
    d.commit()
    return {"id": str(alert.id)}


@router.delete("/api/alerts/{alert_id}")
def delete_alert(alert_id: str, d: DbSession, u: CurrentUser) -> dict[str, bool]:
    alert = d.query(models.Alert).filter_by(id=alert_id, user_id=u.id).first()
    if alert:
        d.delete(alert)
        d.commit()
    return {"ok": True}
