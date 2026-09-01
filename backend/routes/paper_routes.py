import logging
import json
from datetime import datetime, time
from typing import Annotated, Any, Optional, cast
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from .. import models
from ..paper_engine.pricing import capital_required, charges
from ..state import db, fyers, paper, risk, get_market_user
from .paper_common import PaperTradeOutcome, number as _number, payload_float as _payload_float, payload_time as _payload_time, text as _text, utcnow as _utcnow

log = logging.getLogger("fno-backend-paper")
router = APIRouter()
DbSession = Annotated[Session, Depends(db)]
MarketUser = Annotated[Any, Depends(get_market_user)]


def _quote_tick(payload: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
    values = item.get("v") if isinstance(item.get("v"), dict) else {}
    v = cast(dict[str, Any], values)
    premium = payload.get("premium")
    return {
        "ltp": v.get("lp") or item.get("ltp") or premium,
        "bid": v.get("bid") or premium,
        "ask": v.get("ask") or premium,
    }


def _settings(d: Session, user_id: Any) -> dict[str, Any]:
    row = d.query(models.Settings).filter_by(user_id=user_id).first()
    if not row:
        return {}
    try:
        data = json.loads(row.data or "{}")
        return data if isinstance(data, dict) else {}
    except (TypeError, ValueError):
        raise HTTPException(status_code=403, detail="Paper risk blocked. Settings are invalid.")


def _open_qty(record: dict[str, Any]) -> int:
    return int(_number(record.get("openQty", record.get("qty", 0))))


def _position_exposure(rows: list[dict[str, Any]]) -> float:
    exposure = 0.0
    for row in rows:
        qty = abs(_open_qty(row))
        mark = _number(row.get("ltp") or row.get("avgPrice") or row.get("price"))
        exposure += qty * mark
    return exposure


def _lot_size(symbol: str, payload: dict[str, Any]) -> int:
    provided = int(_number(payload.get("lotSize"), 0))
    if provided > 0:
        return provided
    normalized = symbol.upper()
    if "BANKNIFTY" in normalized:
        return 15
    if "FINNIFTY" in normalized:
        return 40
    if "MIDCPNIFTY" in normalized:
        return 50
    if "SENSEX" in normalized:
        return 10
    if "NIFTY" in normalized:
        return 25
    return 1


def _order_price(payload: dict[str, Any], tick: dict[str, Any], side: str) -> float:
    if payload.get("orderType") == "LIMIT" or payload.get("type") in ("LIMIT", 1, "1"):
        price = _number(payload.get("limitPrice") or payload.get("price"))
        if price > 0:
            return price
    quote_key = "ask" if side == "BUY" else "bid"
    return _number(tick.get(quote_key) or tick.get("ltp") or payload.get("premium") or payload.get("price"))


def _today_trade_count(d: Session, user_id: Any) -> int:
    today = datetime.combine(_utcnow().date(), time.min)
    return int(d.query(PaperTradeOutcome).filter(
        PaperTradeOutcome.user_id == user_id,
        PaperTradeOutcome.created_at >= today,
    ).count())


def _enforce_paper_risk(payload: dict[str, Any], tick: dict[str, Any], d: Session, user: Any) -> None:
    settings = _settings(d, user.id)
    symbol = _text(payload.get("symbol"))
    side = "BUY" if payload.get("side") in ("BUY", 1, "1") else "SELL"
    qty = int(_number(payload.get("qty")))
    price = _order_price(payload, tick, side)

    if risk.is_kill_switched(user.id) or settings.get("killSwitch") or settings.get("kill_switch"):
        raise HTTPException(status_code=403, detail="Paper risk blocked. Kill switch is active.")
    if not symbol:
        raise HTTPException(status_code=403, detail="Paper risk blocked. Symbol is required.")
    if qty <= 0:
        raise HTTPException(status_code=403, detail="Paper risk blocked. Quantity must be greater than zero.")
    if price <= 0:
        raise HTTPException(status_code=403, detail="Paper risk blocked. No valid price is available.")

    lot_size = _lot_size(symbol, payload)
    if lot_size > 1 and qty % lot_size != 0:
        raise HTTPException(status_code=403, detail=f"Paper risk blocked. Qty must be a multiple of lot size {lot_size}.")

    max_trades = int(_number(settings.get("riskMaxTrades") or settings.get("max_trades")))
    if max_trades > 0 and _today_trade_count(d, user.id) >= max_trades:
        raise HTTPException(status_code=403, detail=f"Paper risk blocked. Max daily trades ({max_trades}) reached.")

    positions = cast(list[dict[str, Any]], paper.list_positions(user.id, fyers))
    duplicate = any(str(row.get("symbol") or "") == symbol and abs(_open_qty(row)) > 0 for row in positions)
    if duplicate:
        raise HTTPException(status_code=403, detail=f"Paper risk blocked. Open paper position already exists for {symbol}.")

    balance = cast(dict[str, Any], paper.balance(user.id, fyers))
    net_pnl = _number(balance.get("netPnl"))
    max_daily_loss = abs(_number(settings.get("riskMaxDailyLoss") or settings.get("max_daily_loss")))
    if max_daily_loss > 0 and net_pnl <= -max_daily_loss:
        raise HTTPException(status_code=403, detail=f"Paper risk blocked. Daily loss limit reached. Net P&L is {net_pnl:.2f}.")

    planned_notional = abs(price * qty)
    exposure = _position_exposure(positions)
    max_exposure = _number(settings.get("riskMaxExposure") or settings.get("max_exposure"))
    if max_exposure > 0 and exposure + planned_notional > max_exposure:
        raise HTTPException(
            status_code=403,
            detail=f"Paper risk blocked. Exposure would be {exposure + planned_notional:.2f}, above limit {max_exposure:.2f}.",
        )

    needed_cash = capital_required(symbol, price, qty) + charges(price, qty, side)
    available = _number(balance.get("available"))
    if available > 0 and needed_cash > available:
        raise HTTPException(
            status_code=403,
            detail=f"Paper risk blocked. Need {needed_cash:.2f}, available {available:.2f}.",
        )


@router.get("/api/paper/balance")
def paper_balance(u: MarketUser):
    return cast(dict[str, Any], paper.balance(u.id, fyers))


@router.get("/api/paper/orders")
def paper_orders(u: MarketUser):
    return cast(list[dict[str, Any]], paper.list_orders(u.id))


@router.get("/api/paper/trades")
def paper_trades(u: MarketUser):
    return cast(list[dict[str, Any]], paper.list_trades(u.id))


@router.get("/api/paper/positions")
def paper_positions(u: MarketUser):
    return cast(list[dict[str, Any]], paper.list_positions(u.id, fyers))


@router.post("/api/paper/place")
async def paper_place(payload: dict[str, Any], d: DbSession, u: MarketUser):
    symbol = _text(payload.get("symbol"))
    tick = cast(Optional[dict[str, Any]], fyers.get_tick(symbol))

    if not tick:
        try:
            q = cast(dict[str, Any], await fyers.quotes([symbol]))
            arr = q.get("d") or q.get("quotes") or []
            if arr:
                item = arr[0] if isinstance(arr[0], dict) else {}
                tick = _quote_tick(payload, cast(dict[str, Any], item))
        except Exception as e:
            log.warning(f"quote fallback failed: {e}")

    if not tick:
        tick = {
            "ltp": payload.get("premium"),
            "bid": payload.get("premium"),
            "ask": payload.get("premium"),
        }

    _enforce_paper_risk(payload, tick, d, u)

    result = cast(dict[str, Any], paper.place(u.id, payload, tick))
    if result.get("ok"):
        order_id = result.get("id")
        if order_id:
            outcome = PaperTradeOutcome(
                user_id=u.id,
                order_id=order_id,
                signal_time=_payload_time(payload.get("signalTime")),
                symbol=payload.get("symbol"),
                side=payload.get("side"),
                qty=int(_number(payload.get("qty"))),
                strategy=payload.get("strategy") or "Manual",
                confidence=_number(payload.get("confidence")),
                entry=_number(payload.get("entry") or result.get("fill") or tick.get("ltp")),
                sl=_payload_float(payload, "sl"),
                t1=_payload_float(payload, "t1"),
                t2=_payload_float(payload, "t2"),
                notes=payload.get("notes"),
            )
            d.add(outcome)
            d.commit()
            result["outcomeId"] = str(outcome.id)
    return result


@router.post("/api/paper/exit/{order_id}")
async def paper_exit(order_id: str, d: DbSession, u: MarketUser, payload: Optional[dict[str, Any]] = None):
    payload = payload or {}
    qty = payload.get("qty")
    result = cast(dict[str, Any], paper.exit(u.id, order_id, fyers, qty=qty))
    if result.get("status") in ("EXITED", "PARTIAL_EXITED"):
        outcome = d.query(PaperTradeOutcome).filter(
            PaperTradeOutcome.user_id == u.id,
            PaperTradeOutcome.symbol == order_id,
            PaperTradeOutcome.closed.is_(False)
        ).order_by(PaperTradeOutcome.created_at.desc()).first()
        if not outcome:
            outcome = d.query(PaperTradeOutcome).filter_by(user_id=u.id, order_id=order_id, closed=False).first()
        if outcome:
            fill = result.get("fill")
            exit_pnl = float(result.get("pnl") or 0)
            outcome.pnl = float(outcome.pnl or 0) + exit_pnl
            outcome.closed = result.get("status") == "EXITED" or int(result.get("remainingQty") or 0) <= 0
            if fill is not None and outcome.entry is not None:
                if outcome.side == "BUY":
                    if outcome.sl is not None and fill <= outcome.sl:
                        outcome.sl_hit = True
                    if outcome.t1 is not None and fill >= outcome.t1:
                        outcome.t1_hit = True
                    if outcome.t2 is not None and fill >= outcome.t2:
                        outcome.t2_hit = True
                else:
                    if outcome.sl is not None and fill >= outcome.sl:
                        outcome.sl_hit = True
                    if outcome.t1 is not None and fill <= outcome.t1:
                        outcome.t1_hit = True
                    if outcome.t2 is not None and fill <= outcome.t2:
                        outcome.t2_hit = True
            d.commit()
    return result


@router.post("/api/paper/reset")
def paper_reset(d: DbSession, u: MarketUser):
    paper.reset(u.id)
    d.query(PaperTradeOutcome).filter_by(user_id=u.id).delete(synchronize_session=False)
    d.commit()
    return {"ok": True}
