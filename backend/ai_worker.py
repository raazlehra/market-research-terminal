"""Loopback-only optional TradingAgents worker.

This process has no broker, account, exchange, database, or execution objects.
It accepts only the already bounded analysis snapshot contract.
"""

from __future__ import annotations

import ipaddress
import os
from typing import Any
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, HTTPException, Request

from .analysis.tradingagents_adapter import (
    TradingAgentsAdapter,
    TradingAgentsOutputRejected,
    TradingAgentsUnavailable,
)
from .analysis.worker_client import (
    AIWorkerRequest,
    AIWorkerResponse,
    normalize_worker_url,
)


def require_loopback(request: Request) -> None:
    host = request.client.host if request.client else ""
    try:
        is_loopback = ipaddress.ip_address(host).is_loopback
    except ValueError:
        is_loopback = host == "localhost"
    if not is_loopback:
        raise HTTPException(403, "AI worker accepts loopback requests only")


def create_app(adapter: Any | None = None) -> FastAPI:
    analysis_adapter = adapter or TradingAgentsAdapter()
    worker = FastAPI(
        title="Market Research Terminal Local AI Worker",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @worker.get("/health", dependencies=[Depends(require_loopback)])
    async def health() -> dict[str, Any]:
        status = analysis_adapter.status()
        return {
            "ok": True,
            "enabled": status["enabled"],
            "framework": status["framework"],
            "commit": status["commit"],
            "provider": status["provider"],
            "model": status["model"],
        }

    @worker.post(
        "/v1/analyze",
        response_model=AIWorkerResponse,
        dependencies=[Depends(require_loopback)],
    )
    async def analyze(payload: AIWorkerRequest) -> AIWorkerResponse:
        if payload.expected_fingerprint != analysis_adapter.config.fingerprint:
            raise HTTPException(
                409,
                "AI worker configuration fingerprint does not match",
            )
        try:
            overlay = await analysis_adapter.analyze(
                payload.snapshot,
                payload.horizon,
                payload.research_depth,
                payload.asset_type,
            )
        except TradingAgentsOutputRejected as exc:
            raise HTTPException(422, "AI output failed structured validation") from exc
        except (TradingAgentsUnavailable, TimeoutError) as exc:
            raise HTTPException(503, "Local AI inference is unavailable") from exc
        return AIWorkerResponse(
            fingerprint=analysis_adapter.config.fingerprint,
            overlay=overlay,
        )

    return worker


app = create_app()


def main() -> None:
    import uvicorn

    worker_url = normalize_worker_url(os.getenv("AI_WORKER_URL"))
    parsed = urlparse(worker_url)
    if parsed.hostname is None or parsed.port is None:
        raise RuntimeError("AI_WORKER_URL must identify a loopback host and port")
    uvicorn.run(
        "backend.ai_worker:app",
        host=parsed.hostname,
        port=parsed.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
