from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends, HTTPException

from .. import models
from ..analysis.models import AnalysisRequest, AnalysisResult, ExecutionAttempt
from ..analysis.providers import BinancePublicMarketDataProvider, FyersReadOnlyMarketDataProvider
from ..analysis.service import AnalysisService, ExecutionDisabledError
from ..state import fyers, get_market_user

router = APIRouter(prefix="/api", tags=["read-only-analysis"])
MarketUser = Annotated[models.User, Depends(get_market_user)]
analysis_service = AnalysisService(FyersReadOnlyMarketDataProvider(fyers), BinancePublicMarketDataProvider())


@router.post("/analysis/run", response_model=AnalysisResult)
async def run_analysis(payload: AnalysisRequest, _: MarketUser) -> AnalysisResult:
    try:
        return await analysis_service.analyze(payload)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except httpx.HTTPStatusError as error:
        raise HTTPException(502, f"Market-data provider rejected the request ({error.response.status_code}).") from error
    except httpx.HTTPError as error:
        raise HTTPException(503, "Market-data provider is unavailable.") from error


@router.get("/crypto/market")
async def crypto_market(_: MarketUser, symbol: str = "BTCUSDT", interval: str = "1h") -> dict[str, Any]:
    try:
        return await analysis_service.crypto_provider.market_snapshot(symbol, interval)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except httpx.HTTPStatusError as error:
        raise HTTPException(502, f"Crypto provider rejected the request ({error.response.status_code}).") from error
    except httpx.HTTPError as error:
        raise HTTPException(503, "Crypto provider is unavailable.") from error

@router.get("/futures/market")
async def futures_market(
    _: MarketUser, symbol: str = "NSE:NIFTY50-INDEX", contract_symbol: str | None = None
) -> dict[str, Any]:
    try:
        return await analysis_service.market_provider.futures_snapshot(symbol, contract_symbol)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except httpx.HTTPStatusError as error:
        raise HTTPException(502, f"FYERS futures provider rejected the request ({error.response.status_code}).") from error
    except httpx.HTTPError as error:
        raise HTTPException(503, "FYERS futures provider is unavailable.") from error


@router.get("/analysis/config")
async def analysis_config(_: MarketUser) -> dict[str, Any]:
    return analysis_service.ai_status()


@router.post("/analysis/execute", status_code=403)
async def reject_analysis_execution(payload: ExecutionAttempt, _: MarketUser) -> None:
    try:
        analysis_service.reject_execution(payload)
    except ExecutionDisabledError as error:
        raise HTTPException(403, str(error)) from error
