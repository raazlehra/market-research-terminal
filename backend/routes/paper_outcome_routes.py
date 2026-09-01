from typing import Any, cast

from fastapi import APIRouter, HTTPException

from .paper_common import (
    DbSession,
    MarketUser,
    PaperTradeOutcome,
    attr,
    number,
    payload_float,
    payload_optional_number,
    payload_time,
    row_bool,
    row_float,
    serialize_paper_outcome,
)

router = APIRouter()


@router.get("/api/paper/outcomes")
def paper_outcomes(d: DbSession, u: MarketUser) -> list[dict[str, Any]]:
    rows = cast(list[Any], d.query(PaperTradeOutcome).filter_by(user_id=u.id).order_by(PaperTradeOutcome.created_at.desc()).all())
    return [serialize_paper_outcome(row) for row in rows]


@router.post("/api/paper/outcomes")
def create_paper_outcome(payload: dict[str, Any], d: DbSession, u: MarketUser) -> dict[str, str]:
    outcome = PaperTradeOutcome(
        user_id=u.id,
        order_id=payload.get("orderId"),
        signal_time=payload_time(payload.get("signalTime")),
        symbol=payload.get("symbol"),
        side=payload.get("side"),
        qty=int(number(payload.get("qty"))),
        strategy=payload.get("strategy") or "Manual",
        confidence=number(payload.get("confidence")),
        entry=number(payload.get("entry")),
        sl=payload_float(payload, "sl"),
        t1=payload_float(payload, "t1"),
        t2=payload_float(payload, "t2"),
        closed=bool(payload.get("closed", False)),
        sl_hit=bool(payload.get("slHit", False)),
        t1_hit=bool(payload.get("t1Hit", False)),
        t2_hit=bool(payload.get("t2Hit", False)),
        pnl=payload_optional_number(payload, "pnl"),
        notes=payload.get("notes"),
    )
    d.add(outcome)
    d.commit()
    return {"id": str(outcome.id)}


@router.patch("/api/paper/outcomes/{outcome_id}")
def update_paper_outcome(outcome_id: str, payload: dict[str, Any], d: DbSession, u: MarketUser) -> dict[str, bool]:
    outcome = d.query(PaperTradeOutcome).filter_by(id=outcome_id, user_id=u.id).first()
    if not outcome:
        raise HTTPException(status_code=404, detail="Outcome not found")
    for key, value in payload.items():
        if key == "confidence":
            setattr(outcome, "confidence", float(value or 0))
        elif key == "qty":
            setattr(outcome, "qty", int(value or 0))
        elif key in {"entry", "sl", "t1", "t2", "pnl"}:
            setattr(outcome, key, float(value) if value is not None else None)
        elif key in {"slHit", "t1Hit", "t2Hit", "closed"}:
            field = {
                "slHit": "sl_hit",
                "t1Hit": "t1_hit",
                "t2Hit": "t2_hit",
                "closed": "closed",
            }[key]
            setattr(outcome, field, bool(value))
        else:
            setattr(outcome, key, value)
    d.commit()
    return {"ok": True}


@router.get("/api/paper/outcomes/summary")
def paper_outcome_summary(d: DbSession, u: MarketUser) -> dict[str, Any]:
    rows = cast(list[Any], d.query(PaperTradeOutcome).filter_by(user_id=u.id).all())
    closed = [row for row in rows if row_bool(row, "closed") or attr(row, "pnl") is not None]

    def row_return(row: Any) -> float:
        pnl = attr(row, "pnl")
        entry = attr(row, "entry")
        if pnl is None or not entry:
            return 0.0
        basis = abs(number(entry)) or 1.0
        return round((number(pnl) / basis) * 100, 2)

    totals: dict[str, int | float] = {
        "trades": len(closed),
        "wins": sum(1 for row in closed if (attr(row, "pnl") is not None and row_float(row, "pnl") > 0) or row_bool(row, "t1_hit") or row_bool(row, "t2_hit")),
        "losses": sum(1 for row in closed if (attr(row, "pnl") is not None and row_float(row, "pnl") < 0) or row_bool(row, "sl_hit")),
        "netPnl": round(sum(row_float(row, "pnl") for row in closed), 2),
        "avgReturn": round(sum(row_return(row) for row in closed) / max(len(closed), 1), 2),
    }
    gross_profit = sum(row_float(row, "pnl") for row in closed if row_float(row, "pnl") > 0)
    gross_loss = sum(abs(row_float(row, "pnl")) for row in closed if row_float(row, "pnl") < 0)
    totals["profitFactor"] = round(gross_profit / max(gross_loss, 1), 2)
    totals["winRate"] = round(totals["wins"] / max(totals["trades"], 1), 3)

    buckets: list[dict[str, int | float | str]] = []
    for label, low, high in [("50-60", 50, 60), ("60-70", 60, 70), ("70-80", 70, 80), ("80-90", 80, 90), ("90+", 90, 200)]:
        group = [row for row in closed if low <= row_float(row, "confidence") < high]
        profits = sum(row_float(row, "pnl") for row in group if row_float(row, "pnl") > 0)
        losses = sum(abs(row_float(row, "pnl")) for row in group if row_float(row, "pnl") < 0)
        buckets.append({
            "bucket": label,
            "trades": len(group),
            "winRate": round(sum(1 for row in group if (attr(row, "pnl") is not None and row_float(row, "pnl") > 0) or row_bool(row, "t1_hit") or row_bool(row, "t2_hit")) / max(len(group), 1), 3),
            "avgReturn": round(sum(row_return(row) for row in group) / max(len(group), 1), 2),
            "profitFactor": round(profits / max(losses, 1), 2),
            "grossProfit": round(profits, 2),
            "grossLoss": round(losses, 2),
        })

    return {"totals": totals, "buckets": buckets}
