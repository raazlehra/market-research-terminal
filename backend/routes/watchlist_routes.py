import json
from typing import Any

from fastapi import APIRouter, HTTPException

from .. import models
from .common import CurrentUser, DbSession, json_list

router = APIRouter()


@router.get("/api/watchlists")
def list_watchlists(d: DbSession, u: CurrentUser) -> list[dict[str, Any]]:
    watchlists = d.query(models.Watchlist).filter_by(user_id=u.id).all()
    return [{"id": str(w.id), "name": w.name, "symbols": json_list(w.symbols)} for w in watchlists]


@router.post("/api/watchlists/{list_id}/symbols")
def add_symbol(list_id: str, payload: dict[str, Any], d: DbSession, u: CurrentUser) -> dict[str, bool]:
    watchlist = d.query(models.Watchlist).filter_by(id=list_id, user_id=u.id).first()
    if not watchlist:
        raise HTTPException(404)
    symbols = json_list(watchlist.symbols)
    if payload["symbol"] not in symbols:
        symbols.append(payload["symbol"])
    watchlist.symbols = json.dumps(symbols)
    d.commit()
    return {"ok": True}


@router.delete("/api/watchlists/{list_id}/symbols/{symbol}")
def del_symbol(list_id: str, symbol: str, d: DbSession, u: CurrentUser) -> dict[str, bool]:
    watchlist = d.query(models.Watchlist).filter_by(id=list_id, user_id=u.id).first()
    if not watchlist:
        raise HTTPException(404)
    symbols = [item for item in json_list(watchlist.symbols) if item != symbol]
    watchlist.symbols = json.dumps(symbols)
    d.commit()
    return {"ok": True}
