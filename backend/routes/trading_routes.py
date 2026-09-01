import time
from typing import Annotated, Any, NoReturn
from fastapi import APIRouter, Depends, HTTPException
from .. import models
from ..state import fyers, get_market_user, get_user

router = APIRouter()
CurrentUser = Annotated[models.User, Depends(get_user)]
MarketUser = Annotated[models.User, Depends(get_market_user)]


def _block_live_trading() -> NoReturn:
    raise HTTPException(403, "Live trading is disabled. Paper trading and read-only market analysis are available.")


@router.get("/api/fyers/profile")
async def profile(u: CurrentUser) -> dict[str, Any]:
    return await fyers.profile()


@router.get("/api/fyers/funds")
async def funds(u: CurrentUser) -> dict[str, float]:
    return await fyers.funds()


@router.get("/api/fyers/holdings")
async def holdings(u: CurrentUser) -> dict[str, Any]:
    return await fyers.holdings()


@router.post("/api/fyers/quotes")
async def quotes(payload: dict[str, Any], u: MarketUser) -> dict[str, Any]:
    return await fyers.quotes(payload["symbols"])


@router.get("/api/fyers/depth")
async def depth(symbol: str, u: MarketUser) -> dict[str, Any]:
    return await fyers.depth(symbol)


@router.get("/api/fyers/history")
async def history(
    u: MarketUser,
    symbol: str,
    resolution: str = "5",
    days: int = 5,
) -> dict[str, Any]:
    to_ts = int(time.time())
    from_ts = to_ts - (days * 86400)
    return await fyers.history(symbol, resolution, from_ts, to_ts)


@router.get("/api/fyers/option-chain")
async def option_chain(u: MarketUser, symbol: str, expiry: str | None = None) -> dict[str, Any]:
    return await fyers.option_chain(symbol, expiry)


@router.get("/api/fyers/expiries")
async def expiries(symbol: str, u: MarketUser) -> list[dict[str, Any]]:
    return await fyers.expiries(symbol)


@router.get("/api/fyers/orders")
async def list_orders(u: CurrentUser) -> dict[str, Any]:
    return await fyers.orders()


@router.get("/api/fyers/positions")
async def list_positions(u: CurrentUser) -> dict[str, Any]:
    return await fyers.positions()


@router.get("/api/fyers/tradebook")
async def list_trades(u: CurrentUser) -> dict[str, Any]:
    return await fyers.tradebook()


@router.post("/api/orders/place")
async def place_order(u: CurrentUser) -> dict[str, Any]:
    _block_live_trading()


@router.put("/api/orders/{order_id}")
async def modify_order(order_id: str, u: CurrentUser) -> dict[str, Any]:
    _block_live_trading()


@router.delete("/api/orders/{order_id}")
async def cancel_order(order_id: str, u: CurrentUser) -> dict[str, Any]:
    _block_live_trading()


@router.post("/api/positions/exit")
async def exit_position(u: CurrentUser) -> dict[str, Any]:
    _block_live_trading()


@router.post("/api/positions/squareoff-all")
async def squareoff_all(u: CurrentUser) -> dict[str, Any]:
    _block_live_trading()


@router.get("/api/dashboard")
async def dashboard(u: CurrentUser) -> dict[str, Any]:
    return await fyers.dashboard()

