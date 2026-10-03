from datetime import datetime, timedelta
from typing import Any, NotRequired, TypedDict

from fastapi import APIRouter

from .. import models
from ..state import paper
from .common import CurrentUser, DbSession, float_value, utcnow

router = APIRouter()


class DailyReportRow(TypedDict):
    date: str
    pnl: float
    trades: int
    wins: int
    cumulative: NotRequired[float]
    win_rate: NotRequired[float]


class StrategyReportRow(TypedDict):
    strategy: str
    net_pnl: float
    trades: int
    wins: int
    win_rate: NotRequired[float]


@router.get("/api/reports")
def reports(d: DbSession, u: CurrentUser, range: str = "30d") -> dict[str, Any]:
    days = {"7d": 7, "30d": 30, "90d": 90, "1y": 365, "all": 3650}.get(range, 30)
    since = utcnow() - timedelta(days=days)
    paper_outcomes = d.query(models.PaperTradeOutcome).filter(
        models.PaperTradeOutcome.user_id == u.id,
        models.PaperTradeOutcome.closed.is_(True),
        models.PaperTradeOutcome.created_at >= since
    ).all()

    if paper_outcomes:
        paper_trades = paper.list_trades(u.id)
        charges_by_date: dict[str, float] = {}
        total_charges = 0.0
        for trade in paper_trades:
            try:
                trade_time = datetime.fromisoformat(str(trade.get("time", "")).replace("Z", "+00:00"))
                trade_day = trade_time.replace(tzinfo=None)
            except Exception:
                continue
            if trade_day < since:
                continue
            charge = float(trade.get("charges") or 0)
            key = trade_day.strftime("%Y-%m-%d")
            charges_by_date[key] = charges_by_date.get(key, 0) + charge
            total_charges += charge

        by_date: dict[str, DailyReportRow] = {}
        by_strat: dict[str, StrategyReportRow] = {}
        for outcome in paper_outcomes:
            report_date = outcome.created_at or outcome.signal_time or utcnow()
            key = report_date.strftime("%Y-%m-%d")
            pnl = float_value(outcome.pnl)
            by_date.setdefault(key, {"date": key, "pnl": 0.0, "trades": 0, "wins": 0})
            by_date[key]["pnl"] += pnl
            by_date[key]["trades"] += 1
            if pnl > 0:
                by_date[key]["wins"] += 1

            strategy = outcome.strategy or "Paper Trades"
            by_strat.setdefault(strategy, {"strategy": strategy, "net_pnl": 0.0, "trades": 0, "wins": 0})
            by_strat[strategy]["net_pnl"] += pnl
            by_strat[strategy]["trades"] += 1
            if pnl > 0:
                by_strat[strategy]["wins"] += 1

        daily: list[DailyReportRow] = sorted(by_date.values(), key=lambda row: row["date"])
        cumulative = 0.0
        for row in daily:
            row["pnl"] = round(row["pnl"] - charges_by_date.get(row["date"], 0), 2)
            cumulative += row["pnl"]
            row["cumulative"] = round(cumulative, 2)
            row["win_rate"] = round(row["wins"] / max(row["trades"], 1), 3)

        for row in by_strat.values():
            row["net_pnl"] = round(row["net_pnl"], 2)
            row["win_rate"] = round(row["wins"] / max(row["trades"], 1), 3)

        gross_pnl = sum(float_value(outcome.pnl) for outcome in paper_outcomes)
        totals = {
            "trades": len(paper_outcomes),
            "net_pnl": round(gross_pnl - total_charges, 2),
            "gross_pnl": round(gross_pnl, 2),
            "charges": round(total_charges, 2),
            "win_rate": round(sum(1 for outcome in paper_outcomes if float_value(outcome.pnl) > 0) / max(len(paper_outcomes), 1), 3),
        }
        return {"daily": daily, "by_strategy": list(by_strat.values()), "totals": totals, "source": "paper"}

    entries = d.query(models.JournalEntry).filter(
        models.JournalEntry.user_id == u.id,
        models.JournalEntry.date >= since
    ).all()

    by_date: dict[str, DailyReportRow] = {}
    by_strat: dict[str, StrategyReportRow] = {}
    for entry in entries:
        entry_date = entry.date or utcnow()
        key = entry_date.strftime("%Y-%m-%d")
        by_date.setdefault(key, {"date": key, "pnl": 0.0, "trades": 0, "wins": 0})
        entry_pnl = float_value(entry.pnl)
        by_date[key]["pnl"] += entry_pnl
        by_date[key]["trades"] += 1
        if entry_pnl > 0:
            by_date[key]["wins"] += 1

        strategy = entry.strategy or "Uncategorized"
        by_strat.setdefault(strategy, {"strategy": strategy, "net_pnl": 0.0, "trades": 0, "wins": 0})
        by_strat[strategy]["net_pnl"] += entry_pnl
        by_strat[strategy]["trades"] += 1
        if entry_pnl > 0:
            by_strat[strategy]["wins"] += 1

    daily: list[DailyReportRow] = sorted(by_date.values(), key=lambda row: row["date"])
    cumulative = 0.0
    for row in daily:
        cumulative += row["pnl"]
        row["cumulative"] = round(cumulative, 2)
        row["win_rate"] = round(row["wins"] / row["trades"], 3)

    for row in by_strat.values():
        row["win_rate"] = round(row["wins"] / max(row["trades"], 1), 3)

    totals = {
        "trades": len(entries),
        "net_pnl": sum(float_value(entry.pnl) for entry in entries),
        "gross_pnl": sum(float_value(entry.pnl) for entry in entries),
        "charges": 0,
        "win_rate": round(sum(1 for entry in entries if float_value(entry.pnl) > 0) / max(len(entries), 1), 3),
    }
    return {"daily": daily, "by_strategy": list(by_strat.values()), "totals": totals}
