import uuid
from datetime import datetime
from typing import Any, Protocol, cast

from .pricing import capital_required, charges, market_open, same_direction
from .quotes import quote_tick
from .records import float_value, int_value, open_qty
from .types import BalanceMap, FyersQuoteClient, PaperLedger, PaperRecord


class PaperOrderOwner(Protocol):
    orders: PaperLedger
    trades: PaperLedger
    balances: BalanceMap
    positions: PaperLedger


def _order_owner(value: object) -> PaperOrderOwner:
    return cast(PaperOrderOwner, value)


def _owner_key(value: object, uid: Any) -> str:
    return str(getattr(value, "_key")(uid))


def _owner_ensure(value: object, uid: Any) -> None:
    getattr(value, "_ensure")(uid)


def _owner_save_state(value: object) -> None:
    getattr(value, "_save_state")()


class PaperOrderMixin:
    def place(self, uid: str, payload: PaperRecord, tick: PaperRecord) -> PaperRecord:
        owner = _order_owner(self)
        uid = _owner_key(self, uid)
        _owner_ensure(self, uid)
        symbol = str(payload.get("symbol") or "")
        side = "BUY" if payload.get("side") in ("BUY", 1, "1") else "SELL"
        qty = int_value(payload.get("qty"))

        if not market_open():
            return {"ok": False, "message": "Market is closed"}

        raw_type = payload.get("type") or payload.get("order_type") or payload.get("orderType")
        if raw_type in ("MARKET", 2, "2"):
            ot = "MARKET"
        elif raw_type in ("LIMIT", 1, "1"):
            ot = "LIMIT"
        elif raw_type in ("SL", 3, "3"):
            ot = "SL"
        elif raw_type in ("SL-M", 4, "4"):
            ot = "SL-M"
        else:
            ot = "MARKET"

        price_in = float_value(payload.get("limitPrice") or payload.get("price") or 0)
        trigger = float_value(payload.get("triggerPrice") or payload.get("trigger") or 0)

        if qty <= 0:
            return {"ok": False, "message": "qty must be > 0"}
        if not tick:
            tick = {}

        if not tick.get("ltp"):
            tick["ltp"] = float_value(payload.get("premium") or payload.get("price") or payload.get("limitPrice") or 0)
        if not tick.get("bid"):
            tick["bid"] = tick["ltp"]
        if not tick.get("ask"):
            tick["ask"] = tick["ltp"]
        if not tick.get("ltp"):
            return {"ok": False, "message": "no price available"}

        import random
        slippage = tick["ltp"] * (0.0001 + random.random() * 0.0002)
        fill = tick["ltp"] + (slippage if side == "BUY" else -slippage)
        if side == "BUY" and tick.get("ask"):
            fill = tick["ask"] + random.random() * 0.05
        if side == "SELL" and tick.get("bid"):
            fill = tick["bid"] - random.random() * 0.05

        if ot == "LIMIT":
            if side == "BUY" and price_in < tick["ltp"]:
                oid = str(uuid.uuid4())
                order = self._order_record(oid, symbol, side, qty, ot, price_in, trigger, "OPEN", payload)
                owner.orders[uid].insert(0, order)
                _owner_save_state(self)
                return {"id": oid, "status": "OPEN", "message": "LIMIT order placed; waiting for fill"}
            fill = price_in

        if ot in ("SL", "SL-M"):
            if (side == "BUY" and tick["ltp"] < trigger) or (side == "SELL" and tick["ltp"] > trigger):
                oid = str(uuid.uuid4())
                order = self._order_record(oid, symbol, side, qty, ot, price_in or fill, trigger, "TRIGGER_PENDING", payload)
                owner.orders[uid].insert(0, order)
                _owner_save_state(self)
                return {"id": oid, "status": "TRIGGER_PENDING"}

        fill_charges = charges(fill, qty, side)
        margin_required = capital_required(symbol, fill, qty)
        owner.balances[uid]["used"] += margin_required
        owner.balances[uid]["available"] -= margin_required + fill_charges

        oid = str(uuid.uuid4())
        order = self._order_record(oid, symbol, side, qty, ot, fill, trigger, "FILLED", payload)
        order["openQty"] = qty if side == "BUY" else -qty
        order["avgPrice"] = fill
        owner.orders[uid].insert(0, order)
        self._update_position_after_fill(uid, oid, symbol, side, qty, fill, payload)

        trade: PaperRecord = {
            "id": str(uuid.uuid4()),
            "orderId": oid,
            "symbol": symbol,
            "side": side,
            "qty": qty,
            "price": fill,
            "charges": fill_charges,
            "productType": payload.get("productType", "INTRADAY"),
            "exchange": payload.get("exchange", "NSE"),
            "validity": payload.get("validity", "DAY"),
            "time": datetime.now().astimezone().isoformat(),
        }
        owner.trades[uid].insert(0, trade)
        _owner_save_state(self)
        return {"ok": True, "id": oid, "status": "FILLED", "fill": fill, "charges": fill_charges}

    def exit(self, uid: Any, order_id: str, fyers_client: FyersQuoteClient, qty: Any = None) -> PaperRecord:
        owner = _order_owner(self)
        uid = _owner_key(self, uid)
        _owner_ensure(self, uid)
        order = next(
            (o for o in owner.orders[uid] if (o.get("id") == order_id or o.get("symbol") == order_id) and o.get("status") == "FILLED"),
            None,
        )
        if not order:
            return {"error": "no open order"}

        symbol = str(order.get("symbol") or "")
        position = next((p for p in owner.positions[uid] if p.get("symbol") == symbol), None)
        if position:
            position_qty = open_qty(position)
            if abs(position_qty) == 0:
                return {"error": "no open position to exit"}
            total_qty = abs(position_qty)
            side = "SELL" if position_qty > 0 else "BUY"
            avg_price = float_value(position.get("avgPrice", order.get("avgPrice", 0)))
        else:
            position_qty = open_qty(order)
            total_qty = abs(position_qty)
            if total_qty == 0:
                return {"error": "no open quantity for exit"}
            side = "SELL" if position_qty > 0 else "BUY"
            avg_price = float_value(order.get("avgPrice"))

        tick = fyers_client.get_tick(symbol) or quote_tick(fyers_client, symbol, "PAPER EXIT QUOTE ERROR:")
        fallback_exit_price = False
        if not tick:
            if avg_price <= 0:
                return {"error": "no live price for exit"}
            tick = {"ltp": avg_price, "bid": avg_price, "ask": avg_price}
            fallback_exit_price = True

        requested_qty = int_value(qty) if qty is not None else total_qty
        if requested_qty <= 0:
            return {"error": "exit quantity must be > 0"}

        exit_qty = min(requested_qty, total_qty)
        fill = float_value(tick.get("ltp"))
        if fill <= 0:
            if avg_price <= 0:
                return {"error": "no live price for exit"}
            fill = avg_price
            fallback_exit_price = True
        exit_charges = charges(fill, exit_qty, side)
        pnl = (fill - avg_price) * exit_qty if side == "SELL" else (avg_price - fill) * exit_qty
        self._release_margin(uid, symbol, avg_price, exit_qty, pnl, exit_charges)

        remaining = total_qty - exit_qty
        self._apply_exit_to_books(uid, symbol, position_qty, remaining)

        trade: PaperRecord = {
            "id": str(uuid.uuid4()),
            "orderId": order.get("id"),
            "symbol": symbol,
            "side": side,
            "qty": exit_qty,
            "price": fill,
            "charges": exit_charges,
            "pnl": pnl,
            "time": datetime.now().astimezone().isoformat(),
        }
        owner.trades[uid].insert(0, trade)
        _owner_save_state(self)
        status = "PARTIAL_EXITED" if remaining > 0 else "EXITED"
        return {
            "status": status,
            "pnl": pnl,
            "charges": exit_charges,
            "fill": fill,
            "exitedQty": exit_qty,
            "remainingQty": remaining,
            "priceFallback": fallback_exit_price,
        }

    def reset(self, uid: Any) -> None:
        owner = _order_owner(self)
        uid = _owner_key(self, uid)
        owner.orders[uid] = []
        owner.trades[uid] = []
        owner.positions[uid] = []
        owner.balances[uid] = {"starting": 100000, "available": 100000, "used": 0}
        _owner_save_state(self)

    def _order_record(self, oid: str, symbol: str, side: str, qty: int, ot: str, price: float, trigger: float, status: str, payload: PaperRecord) -> PaperRecord:
        return {
            "id": oid,
            "symbol": symbol,
            "side": side,
            "qty": qty,
            "orderType": ot,
            "price": price,
            "trigger": trigger,
            "status": status,
            "time": datetime.now().astimezone().isoformat(),
            "product": payload.get("productType", "INTRADAY"),
            "productType": payload.get("productType", "INTRADAY"),
            "exchange": payload.get("exchange", "NSE"),
            "validity": payload.get("validity", "DAY"),
            "openQty": 0,
            "avgPrice": 0,
            "unrealized": 0,
        }

    def _update_position_after_fill(self, uid: str, oid: str, symbol: str, side: str, qty: int, fill: float, payload: PaperRecord | None = None) -> None:
        owner = _order_owner(self)
        existing_pos = next((p for p in owner.positions[uid] if p.get("symbol") == symbol), None)
        if existing_pos is None:
            pos: PaperRecord = {"symbol": symbol, "qty": 0, "openQty": 0, "avgPrice": 0, "unrealized": 0, "orderId": oid}
            owner.positions[uid].append(pos)
        else:
            pos = existing_pos

        prev = int_value(pos.get("qty"))
        new = prev + (qty if side == "BUY" else -qty)
        if (prev == 0) or (prev > 0 and new > 0) or (prev < 0 and new < 0):
            avg_price = float_value(pos.get("avgPrice"))
            pos["avgPrice"] = (abs(prev) * avg_price + qty * fill) / max(abs(new), 1)
        pos["qty"] = new
        pos["openQty"] = new
        pos["orderId"] = oid
        if payload:
            pos["productType"] = payload.get("productType", "INTRADAY")
            pos["exchange"] = payload.get("exchange", "NSE")
            pos["validity"] = payload.get("validity", "DAY")
        if new == 0:
            owner.positions[uid] = [p for p in owner.positions[uid] if p.get("symbol") != symbol]

    def _release_margin(self, uid: str, symbol: str, avg_price: float, exit_qty: int, pnl: float, exit_charges: float) -> None:
        owner = _order_owner(self)
        margin_release = capital_required(symbol, avg_price, exit_qty)
        owner.balances[uid]["available"] += margin_release + pnl - exit_charges
        owner.balances[uid]["used"] = max(0, owner.balances[uid]["used"] - margin_release)

    def _apply_exit_to_books(self, uid: str, symbol: str, position_qty: int, remaining: int) -> None:
        owner = _order_owner(self)
        remaining_signed = remaining if position_qty > 0 else -remaining
        if remaining > 0:
            for p in owner.positions[uid]:
                if p.get("symbol") == symbol:
                    p["qty"] = remaining_signed
                    p["openQty"] = remaining_signed
                    break
            for o in owner.orders[uid]:
                open_qty_value = open_qty(o)
                if o.get("symbol") == symbol and o.get("status") == "FILLED" and same_direction(open_qty_value, position_qty):
                    o["openQty"] = remaining_signed
                    break
            return

        if symbol:
            for o in owner.orders[uid]:
                if o.get("symbol") == symbol and o.get("status") == "FILLED":
                    o["openQty"] = 0
                    o["status"] = "CLOSED"
            for p in owner.positions[uid]:
                if p.get("symbol") == symbol:
                    p["qty"] = 0
                    p["openQty"] = 0
                    break
        owner.positions[uid] = [p for p in owner.positions[uid] if p.get("symbol") != symbol or abs(open_qty(p)) > 0]
