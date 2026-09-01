from typing import Any, List, Optional, Protocol, cast

from .pricing import capital_required
from .quotes import price_from_tick, quote_tick
from .records import float_value, open_qty
from .types import BalanceMap, FyersQuoteClient, PaperLedger, PaperRecord


class PaperViewOwner(Protocol):
    orders: PaperLedger
    trades: PaperLedger
    balances: BalanceMap
    positions: PaperLedger


def _view_owner(value: object) -> PaperViewOwner:
    return cast(PaperViewOwner, value)


def _owner_key(value: object, uid: Any) -> str:
    return str(getattr(value, "_key")(uid))


def _owner_ensure(value: object, uid: Any) -> None:
    getattr(value, "_ensure")(uid)


class PaperViewMixin:
    def balance(self, uid: Any, fyers_client: Optional[FyersQuoteClient] = None) -> PaperRecord:
        owner = _view_owner(self)
        uid = _owner_key(self, uid)
        _owner_ensure(self, uid)
        if fyers_client is not None:
            self.list_positions(uid, fyers_client)

        b = self._reconciled_balance(uid)
        unreal = sum(float_value(p.get("unrealized")) for p in owner.positions[uid])
        b["unrealized"] = round(unreal, 2)
        starting = float_value(b.get("starting"))
        available = float_value(b.get("available"))
        used = float_value(b.get("used"))
        net_pnl = available + used + unreal - starting
        b["realizedPnl"] = round(net_pnl - unreal, 2)
        b["netPnl"] = round(net_pnl, 2)
        b["totalCharges"] = round(sum(float_value(t.get("charges")) for t in owner.trades[uid]), 2)
        return b

    def _reconciled_balance(self, uid: str) -> PaperRecord:
        owner = _view_owner(self)
        balance = owner.balances[uid]
        starting = float_value(balance.get("starting"), 100000.0)
        used = 0.0

        for position in owner.positions[uid]:
            qty = abs(open_qty(position))
            avg_price = float_value(position.get("avgPrice"))
            if qty > 0 and avg_price > 0:
                used += capital_required(str(position.get("symbol") or ""), avg_price, qty)

        realized_pnl = sum(float_value(trade.get("pnl")) for trade in owner.trades[uid])
        total_charges = sum(float_value(trade.get("charges")) for trade in owner.trades[uid])
        balance["starting"] = starting
        balance["used"] = used
        balance["available"] = starting + realized_pnl - total_charges - used
        return dict(balance)

    def list_orders(self, uid: Any) -> List[PaperRecord]:
        owner = _view_owner(self)
        uid = _owner_key(self, uid)
        return owner.orders[uid]

    def list_trades(self, uid: Any) -> List[PaperRecord]:
        owner = _view_owner(self)
        uid = _owner_key(self, uid)
        return owner.trades[uid]

    def list_positions(self, uid: Any, fyers_client: FyersQuoteClient) -> List[PaperRecord]:
        owner = _view_owner(self)
        uid = _owner_key(self, uid)
        _owner_ensure(self, uid)
        owner.positions[uid] = [p for p in owner.positions[uid] if abs(open_qty(p)) > 0]

        for p in owner.positions[uid]:
            symbol = str(p.get("symbol") or "")
            tick = fyers_client.get_tick(symbol)
            ltp = price_from_tick(tick)

            if ltp is None:
                quote = quote_tick(fyers_client, symbol, "PAPER QUOTE ERROR:")
                if quote:
                    ltp = price_from_tick(quote)

            if ltp is None:
                ltp = float_value(p.get("avgPrice"))

            p["ltp"] = ltp
            qty = open_qty(p)
            if qty > 0:
                p["unrealized"] = round((float_value(ltp) - float_value(p.get("avgPrice"))) * qty, 2)
            elif qty < 0:
                p["unrealized"] = round((float_value(p.get("avgPrice")) - float_value(ltp)) * abs(qty), 2)
            else:
                p["unrealized"] = 0
        return owner.positions[uid]
