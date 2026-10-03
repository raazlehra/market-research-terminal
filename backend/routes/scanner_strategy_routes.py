from typing import Any, Literal, Protocol, cast

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from ..state import fyers, scanner
from .common import CurrentUser, JsonRecord, float_value, json_records

router = APIRouter()


class QuoteClient(Protocol):
    async def quotes(self, symbols: list[str]) -> JsonRecord:
        ...


typed_fyers = cast(QuoteClient, fyers)


class ScannerParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    universe: Literal["FNO", "NIFTY50"] = "FNO"
    resolution: Literal["5", "15", "60"] = "15"
    scanId: int = Field(default=0, ge=0)
    minVolume: int | None = Field(default=None, ge=0, le=10_000_000_000)
    minChange: float | None = Field(default=None, ge=0, le=100)


class ScannerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["VWAP_BREAKOUT", "BREAKOUT_VOLUME", "BREAKOUT", "EMA_CROSS", "VOLUME_SPIKE"]
    params: ScannerParams = Field(default_factory=ScannerParams)


@router.post("/api/scanner/run")
async def run_scan(payload: ScannerRequest, u: CurrentUser) -> Any:
    params = cast(JsonRecord, payload.params.model_dump(exclude_none=True))
    return await scanner.run(payload.type, params, payload.params.universe)


@router.post("/api/strategies/payoff")
async def strategy_payoff(payload: dict[str, Any], u: CurrentUser) -> dict[str, Any]:
    raw_legs: object = payload.get("legs", [])
    legs = json_records(raw_legs)
    spot = float_value(payload.get("spot"))
    try:
        symbols = [leg.get("symbol") for leg in legs if leg.get("symbol")]
        if symbols:
            response = await typed_fyers.quotes([str(symbol) for symbol in symbols])
            quotes_raw: object = response.get("quotes", [])
            quotes = json_records(quotes_raw)
            quote_map: dict[str, JsonRecord] = {str(row["symbol"]): row for row in quotes if row.get("symbol")}
            for leg in legs:
                if leg["symbol"] in quote_map:
                    leg["premium"] = quote_map[leg["symbol"]].get("ltp", leg["premium"])
    except Exception:
        pass

    low, high = spot * 0.95, spot * 1.05
    points: list[dict[str, Any]] = []
    step = max(1, (high - low) / 200)
    price = low
    while price <= high:
        pnl = 0
        for leg in legs:
            intrinsic = max(0, price - leg["strike"]) if leg["type"] == "CE" else max(0, leg["strike"] - price)
            mtm = (intrinsic - leg["premium"]) * leg["qty"] if leg["side"] == "BUY" else (leg["premium"] - intrinsic) * leg["qty"]
            pnl += mtm
        points.append({"spot": round(price), "pnl": round(pnl)})
        price += step
    return {"points": points, "legs": legs}
