"""Local-only client and transport contracts for optional AI analysis."""

from __future__ import annotations

import json
import os
import re
from typing import Any, Literal
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .tradingagents_adapter import (
    AIOverlay,
    PINNED_TRADINGAGENTS_COMMIT,
    PINNED_TRADINGAGENTS_VERSION,
    TradingAgentsConfig,
    TradingAgentsOutputRejected,
    TradingAgentsUnavailable,
    bounded_snapshot,
)

DEFAULT_AI_WORKER_URL = "http://127.0.0.1:8124"
MAX_WORKER_REQUEST_BYTES = 128_000
SENSITIVE_KEYS = {
    "access_token",
    "account",
    "account_token",
    "authorization",
    "broker",
    "broker_session",
    "client_secret",
    "encryption_key",
    "fyers_token",
    "private_key",
    "refresh_token",
    "secret",
    "session_secret",
    "token",
    "wallet",
    "wallet_seed",
}


def _canonical_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value).strip().lower()).strip("_")


def _contains_sensitive_key(value: Any) -> bool:
    if isinstance(value, dict):
        return any(
            _canonical_key(key) in SENSITIVE_KEYS or _contains_sensitive_key(child)
            for key, child in value.items()
        )
    if isinstance(value, list):
        return any(_contains_sensitive_key(child) for child in value)
    return False


def normalize_worker_url(value: str | None) -> str:
    raw = (value or DEFAULT_AI_WORKER_URL).strip().rstrip("/")
    parsed = urlparse(raw)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise ValueError("AI_WORKER_URL must be an HTTP loopback origin")
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("AI_WORKER_URL contains an invalid port") from exc
    if port is None:
        raise ValueError("AI_WORKER_URL must include an explicit port")
    return raw


class AIWorkerRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    snapshot: dict[str, Any]
    horizon: str = Field(min_length=2, max_length=40)
    research_depth: Literal["quick", "standard", "deep"]
    asset_type: Literal["equity", "fno", "crypto"]
    expected_fingerprint: str = Field(pattern=r"^[0-9a-f]{12}$")

    @model_validator(mode="after")
    def validate_snapshot_boundary(self) -> "AIWorkerRequest":
        if _contains_sensitive_key(self.snapshot):
            raise ValueError("AI worker snapshots cannot contain credentials or account objects")
        if bounded_snapshot(self.snapshot) != self.snapshot:
            raise ValueError("AI worker requires the already bounded analysis snapshot")
        payload_size = len(
            json.dumps(self.snapshot, sort_keys=True, separators=(",", ":"), default=str)
            .encode("utf-8")
        )
        if payload_size > MAX_WORKER_REQUEST_BYTES:
            raise ValueError("AI worker snapshot exceeds the bounded request limit")
        return self


class AIWorkerResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fingerprint: str = Field(pattern=r"^[0-9a-f]{12}$")
    overlay: AIOverlay


class AIWorkerClient:
    """Fail-closed localhost transport for explicit TradingAgents requests."""

    def __init__(
        self,
        config: TradingAgentsConfig | None = None,
        worker_url: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.config = config or TradingAgentsConfig.from_environment()
        configured_url = worker_url or os.getenv("AI_WORKER_URL")
        self.worker_url = normalize_worker_url(configured_url)
        self._transport = transport

    def status(self) -> dict[str, Any]:
        return {
            "enabled": self.config.enabled,
            "provider": self.config.provider or "not configured",
            "model": self.config.model or "not configured",
            "framework": f"TradingAgents {PINNED_TRADINGAGENTS_VERSION}",
            "commit": PINNED_TRADINGAGENTS_COMMIT,
            "worker": self.worker_url,
            "cost_notice": (
                self.config.cost_notice
                if self.config.provider
                else "No LLM configured; deterministic analysis remains available."
            ),
        }

    async def analyze(
        self,
        snapshot: dict[str, Any],
        horizon: str,
        depth: str,
        asset_type: str | None = None,
    ) -> AIOverlay:
        if not self.config.enabled:
            raise TradingAgentsUnavailable("Optional AI analysis is disabled")
        request = AIWorkerRequest(
            snapshot=bounded_snapshot(snapshot),
            horizon=horizon,
            research_depth=depth,
            asset_type=asset_type or "equity",
            expected_fingerprint=self.config.fingerprint,
        )
        timeout = httpx.Timeout(max(10.0, self.config.timeout_seconds * 8))
        try:
            async with httpx.AsyncClient(
                base_url=self.worker_url,
                timeout=timeout,
                transport=self._transport,
                trust_env=False,
            ) as client:
                response = await client.post(
                    "/v1/analyze",
                    json=request.model_dump(mode="json"),
                )
                response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 422:
                raise TradingAgentsOutputRejected(
                    "Local AI worker rejected the bounded analysis request"
                ) from exc
            raise TradingAgentsUnavailable("Local AI worker is unavailable") from exc
        except httpx.HTTPError as exc:
            raise TradingAgentsUnavailable("Local AI worker is unavailable") from exc

        try:
            result = AIWorkerResponse.model_validate(response.json())
        except (TypeError, ValueError) as exc:
            raise TradingAgentsOutputRejected(
                "Local AI worker returned invalid structured output"
            ) from exc
        if result.fingerprint != self.config.fingerprint:
            raise TradingAgentsOutputRejected(
                "Local AI worker configuration fingerprint does not match"
            )
        return result.overlay
