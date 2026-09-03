from typing import Any, Iterable, cast

from fastapi import APIRouter, HTTPException

from ..state import paper
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


def _rounded(value: float | None) -> float | None:
    return round(value, 2) if value is not None else None


def _safe_pct(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or denominator is None or denominator <= 0:
        return None
    return round((numerator / denominator) * 100, 2)


def _avg(values: Iterable[float | None]) -> float | None:
    available = [value for value in values if value is not None]
    if not available:
        return None
    return round(sum(available) / len(available), 2)


def _sum_available(values: Iterable[float | None]) -> float | None:
    available = [value for value in values if value is not None]
    if not available:
        return None
    return round(sum(available), 2)


def _raw_sum_available(values: Iterable[float | None]) -> float | None:
    available = [value for value in values if value is not None]
    if not available:
        return None
    return sum(available)


def _same_order(trade: dict[str, Any], order_id: Any) -> bool:
    return bool(order_id) and str(trade.get("orderId") or "") == str(order_id)


def _financials_for_outcome(row: Any, ledger_trades: list[dict[str, Any]]) -> dict[str, Any]:
    order_id = attr(row, "order_id")
    side = str(attr(row, "side") or "").upper()
    related = [trade for trade in ledger_trades if _same_order(trade, order_id)]
    entry_fills = [
        trade
        for trade in related
        if str(trade.get("side") or "").upper() == side
        and trade.get("pnl") is None
        and number(trade.get("qty")) > 0
        and number(trade.get("price")) > 0
    ]
    exit_fills = [
        trade
        for trade in related
        if trade not in entry_fills and (trade.get("pnl") is not None or str(trade.get("side") or "").upper() != side)
    ]

    gross_pnl = _raw_sum_available(number(trade.get("pnl")) for trade in exit_fills if trade.get("pnl") is not None)
    if gross_pnl is None and attr(row, "pnl") is not None:
        gross_pnl = number(attr(row, "pnl"))

    if entry_fills:
        entry_notional = sum(abs(number(trade.get("qty"))) * number(trade.get("price")) for trade in entry_fills)
        entry_charges = sum(number(trade.get("charges")) for trade in entry_fills)
        basis_source = "paper_ledger_entry_fills"
        unavailable_reason = None
    else:
        entry_notional = None
        entry_charges = None
        basis_source = "unavailable"
        unavailable_reason = "Executed entry fills are unavailable for this outcome."

    exit_charges = sum(number(trade.get("charges")) for trade in exit_fills) if exit_fills else None
    total_charges = entry_charges + exit_charges if entry_charges is not None and exit_charges is not None else None
    net_pnl = gross_pnl - total_charges if gross_pnl is not None and total_charges is not None else None
    valid_entry_notional = entry_notional if entry_notional is not None and entry_notional > 0 else None
    if entry_notional is not None and entry_notional <= 0:
        basis_source = "unavailable"
        unavailable_reason = "Executed entry notional is zero."

    return {
        "grossPnl": _rounded(gross_pnl),
        "entryCharges": _rounded(entry_charges),
        "exitCharges": _rounded(exit_charges),
        "totalCharges": _rounded(total_charges),
        "netPnl": _rounded(net_pnl),
        "entryNotional": _rounded(valid_entry_notional),
        "grossReturnPct": _safe_pct(gross_pnl, valid_entry_notional),
        "netReturnPct": _safe_pct(net_pnl, valid_entry_notional),
        "returnBasis": {
            "source": basis_source,
            "entryQty": int(sum(abs(number(trade.get("qty"))) for trade in entry_fills)) if entry_fills else None,
            "entryFills": len(entry_fills),
            "exitFills": len(exit_fills),
            "reason": unavailable_reason,
        },
    }


def _ledger_trades_for_user(user_id: Any) -> list[dict[str, Any]]:
    try:
        return cast(list[dict[str, Any]], paper.list_trades(user_id))
    except Exception:
        return []


def _serialize_with_financials(row: Any, ledger_trades: list[dict[str, Any]]) -> dict[str, Any]:
    payload = serialize_paper_outcome(row)
    payload.update(_financials_for_outcome(row, ledger_trades))
    return payload


def _build_outcome_summary(rows: list[Any], ledger_trades: list[dict[str, Any]]) -> dict[str, Any]:
    closed = [
        (row, _financials_for_outcome(row, ledger_trades))
        for row in rows
        if row_bool(row, "closed") or attr(row, "pnl") is not None
    ]

    gross_values = [cast(float | None, financials["grossPnl"]) for _, financials in closed]
    net_values = [cast(float | None, financials["netPnl"]) for _, financials in closed]
    charge_values = [cast(float | None, financials["totalCharges"]) for _, financials in closed]
    entry_charge_values = [cast(float | None, financials["entryCharges"]) for _, financials in closed]
    exit_charge_values = [cast(float | None, financials["exitCharges"]) for _, financials in closed]
    gross_return_values = [cast(float | None, financials["grossReturnPct"]) for _, financials in closed]
    net_return_values = [cast(float | None, financials["netReturnPct"]) for _, financials in closed]

    trade_count = len(closed)
    win_count = sum(
        1
        for row, financials in closed
        if (financials["grossPnl"] is not None and cast(float, financials["grossPnl"]) > 0)
        or row_bool(row, "t1_hit")
        or row_bool(row, "t2_hit")
    )
    loss_count = sum(
        1
        for row, financials in closed
        if (financials["grossPnl"] is not None and cast(float, financials["grossPnl"]) < 0)
        or row_bool(row, "sl_hit")
    )

    totals: dict[str, int | float | None] = {
        "trades": trade_count,
        "wins": win_count,
        "losses": loss_count,
        "grossPnl": _sum_available(gross_values),
        "entryCharges": _sum_available(entry_charge_values),
        "exitCharges": _sum_available(exit_charge_values),
        "totalCharges": _sum_available(charge_values),
        "netPnl": _sum_available(net_values),
        "avgReturn": _avg(gross_return_values),
        "avgGrossReturn": _avg(gross_return_values),
        "avgNetReturn": _avg(net_return_values),
        "returnUnavailable": sum(1 for _, financials in closed if financials["grossReturnPct"] is None),
        "netUnavailable": sum(1 for _, financials in closed if financials["netPnl"] is None),
    }
    gross_profit = sum(value for value in gross_values if value is not None and value > 0)
    gross_loss = sum(abs(value) for value in gross_values if value is not None and value < 0)
    totals["profitFactor"] = round(gross_profit / max(gross_loss, 1), 2)
    totals["winRate"] = round(win_count / max(trade_count, 1), 3)

    buckets: list[dict[str, int | float | str | None]] = []
    for label, low, high in [("50-60", 50, 60), ("60-70", 60, 70), ("70-80", 70, 80), ("80-90", 80, 90), ("90+", 90, 200)]:
        group = [(row, financials) for row, financials in closed if low <= row_float(row, "confidence") < high]
        group_gross_values = [cast(float | None, financials["grossPnl"]) for _, financials in group]
        group_net_values = [cast(float | None, financials["netPnl"]) for _, financials in group]
        group_charge_values = [cast(float | None, financials["totalCharges"]) for _, financials in group]
        group_gross_returns = [cast(float | None, financials["grossReturnPct"]) for _, financials in group]
        group_net_returns = [cast(float | None, financials["netReturnPct"]) for _, financials in group]
        profits = sum(value for value in group_gross_values if value is not None and value > 0)
        losses = sum(abs(value) for value in group_gross_values if value is not None and value < 0)
        buckets.append({
            "bucket": label,
            "trades": len(group),
            "winRate": round(sum(1 for row, financials in group if (financials["grossPnl"] is not None and cast(float, financials["grossPnl"]) > 0) or row_bool(row, "t1_hit") or row_bool(row, "t2_hit")) / max(len(group), 1), 3),
            "avgReturn": _avg(group_gross_returns),
            "avgGrossReturn": _avg(group_gross_returns),
            "avgNetReturn": _avg(group_net_returns),
            "profitFactor": round(profits / max(losses, 1), 2),
            "grossProfit": round(profits, 2),
            "grossLoss": round(losses, 2),
            "grossPnl": _sum_available(group_gross_values),
            "totalCharges": _sum_available(group_charge_values),
            "netPnl": _sum_available(group_net_values),
            "returnUnavailable": sum(1 for _, financials in group if financials["grossReturnPct"] is None),
            "netUnavailable": sum(1 for _, financials in group if financials["netPnl"] is None),
        })

    return {"totals": totals, "buckets": buckets}


@router.get("/api/paper/outcomes")
def paper_outcomes(d: DbSession, u: MarketUser) -> list[dict[str, Any]]:
    rows = cast(list[Any], d.query(PaperTradeOutcome).filter_by(user_id=u.id).order_by(PaperTradeOutcome.created_at.desc()).all())
    ledger_trades = _ledger_trades_for_user(u.id)
    return [_serialize_with_financials(row, ledger_trades) for row in rows]


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
    ledger_trades = _ledger_trades_for_user(u.id)
    return _build_outcome_summary(rows, ledger_trades)
