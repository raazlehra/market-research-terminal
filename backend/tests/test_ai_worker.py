import asyncio
import subprocess
import sys
import unittest
from pathlib import Path
from typing import Any

import httpx

from backend import ai_worker
from backend.ai_worker import create_app
from backend.analysis.models import AnalysisRequest
from backend.analysis.service import AnalysisService
from backend.analysis.tradingagents_adapter import (
    AIOverlay,
    TradingAgentsConfig,
    TradingAgentsUnavailable,
    bounded_snapshot,
)
from backend.analysis.worker_client import AIWorkerClient


def snapshot() -> dict[str, Any]:
    return {
        "instrument": {"asset_type": "equity", "symbol": "NSE:TEST-EQ"},
        "market": {"last_price": 180.0},
        "indicators": {
            "atr14": 2.0,
            "macd": 1.0,
            "macd_signal": 0.5,
            "rsi14": 55.0,
            "trend": "BULLISH",
        },
        "candles": [{"close": 180.0}],
        "data_timestamp": "2026-10-03T00:00:00+00:00",
        "data_freshness": "REAL TIME",
        "data_sources": ["test snapshot"],
    }


def enabled_config() -> TradingAgentsConfig:
    return TradingAgentsConfig(
        enabled=True,
        provider="ollama",
        model="local-test",
        base_url="http://127.0.0.1:11434/v1",
        timeout_seconds=2,
        max_retries=0,
        max_tokens=512,
    )


def overlay() -> AIOverlay:
    return AIOverlay(
        signal="HOLD",
        confidence=60,
        technical_summary="Moderate mixed structured interpretation.",
        bull_case=["Moderate bullish structured interpretation."],
        bear_case=["Moderate bearish structured interpretation."],
        risks=["Moderate mixed risk interpretation."],
        reasoning_summary="Validated specialist evidence is mixed.",
        agents=[
            {
                "agent": "Final Analysis Agent",
                "status": "available",
                "conclusion": "HOLD",
                "evidence": ["snapshot.indicators.trend = BULLISH"],
            }
        ],
        provider="ollama",
        model="local-test",
        cost_notice="LOCAL/FREE MODEL",
    )


class FakeMarket:
    async def stock_snapshot(
        self,
        symbol: str,
        resolution: str,
        days: int,
    ) -> dict[str, Any]:
        return snapshot()

    async def option_snapshot(
        self,
        symbol: str,
        expiry: str | None,
    ) -> dict[str, Any]:
        return snapshot()


class FakeCrypto:
    async def market_snapshot(
        self,
        symbol: str,
        interval: str,
    ) -> dict[str, Any]:
        return snapshot()


class FakeAdapter:
    def __init__(self) -> None:
        self.config = enabled_config()
        self.calls = 0
        self.snapshots: list[dict[str, Any]] = []

    def status(self) -> dict[str, Any]:
        return {
            "enabled": True,
            "provider": "ollama",
            "model": "local-test",
            "framework": "TradingAgents 0.5.2",
            "commit": "5eb50854dad299381861632aa34014448b4260fc",
        }

    async def analyze(
        self,
        prepared_snapshot: dict[str, Any],
        horizon: str,
        depth: str,
        asset_type: str,
    ) -> AIOverlay:
        self.calls += 1
        self.snapshots.append(prepared_snapshot)
        return overlay()


class FakeWorkerClient(FakeAdapter):
    def __init__(
        self,
        *,
        enabled: bool = True,
        unavailable: bool = False,
    ) -> None:
        super().__init__()
        self.config = TradingAgentsConfig(
            enabled=enabled,
            provider="ollama",
            model="local-test",
            base_url="http://127.0.0.1:11434/v1",
            timeout_seconds=2,
            max_retries=0,
            max_tokens=512,
        )
        self.unavailable = unavailable

    async def analyze(
        self,
        prepared_snapshot: dict[str, Any],
        horizon: str,
        depth: str,
        asset_type: str,
    ) -> AIOverlay:
        self.calls += 1
        if self.unavailable:
            raise TradingAgentsUnavailable("worker offline")
        self.snapshots.append(prepared_snapshot)
        return overlay()


async def post(
    app: Any,
    path: str,
    payload: dict[str, Any],
    *,
    client_host: str = "127.0.0.1",
) -> httpx.Response:
    transport = httpx.ASGITransport(
        app=app,
        client=(client_host, 50000),
    )
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://127.0.0.1:8124",
    ) as client:
        return await client.post(path, json=payload)


class AIWorkerBoundaryTests(unittest.TestCase):
    def test_main_backend_imports_without_tradingagents(self) -> None:
        root = Path(__file__).resolve().parents[2]
        code = """
import builtins
original_import = builtins.__import__
def guarded(name, *args, **kwargs):
    if name == "tradingagents" or name.startswith("tradingagents."):
        raise AssertionError("main backend imported TradingAgents")
    return original_import(name, *args, **kwargs)
builtins.__import__ = guarded
import backend.main
"""
        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_dependency_manifests_are_isolated(self) -> None:
        backend_root = Path(__file__).resolve().parents[1]
        main_requirements = (backend_root / "requirements.txt").read_text()
        ai_requirements = (backend_root / "requirements-ai.txt").read_text()

        self.assertIn("fyers-apiv3", main_requirements)
        self.assertIn("requests==2.31.0", main_requirements)
        self.assertNotIn("tradingagents", main_requirements.lower())
        self.assertIn("tradingagents", ai_requirements.lower())
        self.assertNotIn("fyers-apiv3", ai_requirements)
        self.assertNotIn("-r requirements.txt", ai_requirements)

    def test_ai_disabled_requires_no_worker(self) -> None:
        worker = FakeWorkerClient(enabled=False)
        service = AnalysisService(FakeMarket(), FakeCrypto(), worker)
        request = AnalysisRequest(
            asset_type="equity",
            symbol="NSE:TEST-EQ",
            horizon="Swing",
            ai_requested=True,
        )

        result = asyncio.run(service.analyze(request))

        self.assertEqual(worker.calls, 0)
        self.assertEqual(result.analysis_mode, "deterministic")
        self.assertEqual(result.ai_status, "disabled")

    def test_worker_unavailable_fails_closed(self) -> None:
        worker = FakeWorkerClient(unavailable=True)
        service = AnalysisService(FakeMarket(), FakeCrypto(), worker)
        request = AnalysisRequest(
            asset_type="equity",
            symbol="NSE:TEST-EQ",
            horizon="Swing",
            ai_requested=True,
        )

        result = asyncio.run(service.analyze(request))

        self.assertEqual(worker.calls, 1)
        self.assertEqual(result.analysis_mode, "deterministic")
        self.assertEqual(result.ai_status, "unavailable")
        self.assertFalse(result.execution_enabled)
        self.assertEqual(result.signal_type, "analysis_only")

    def test_ordinary_market_refresh_does_not_contact_worker(self) -> None:
        worker = FakeWorkerClient()
        service = AnalysisService(FakeMarket(), FakeCrypto(), worker)
        request = AnalysisRequest(
            asset_type="equity",
            symbol="NSE:TEST-EQ",
            horizon="Swing",
            ai_requested=False,
        )

        asyncio.run(service.market_snapshot(request))

        self.assertEqual(worker.calls, 0)

    def test_cache_hit_does_not_contact_worker_twice(self) -> None:
        worker = FakeWorkerClient()
        service = AnalysisService(FakeMarket(), FakeCrypto(), worker)
        request = AnalysisRequest(
            asset_type="equity",
            symbol="NSE:TEST-EQ",
            horizon="Swing",
            ai_requested=True,
        )

        first = asyncio.run(service.analyze(request))
        second = asyncio.run(service.analyze(request))

        self.assertEqual(first.analysis_mode, "llm")
        self.assertTrue(second.cached)
        self.assertEqual(worker.calls, 1)

    def test_worker_rejects_malformed_unbounded_and_sensitive_requests(self) -> None:
        adapter = FakeAdapter()
        app = create_app(adapter)
        prepared = bounded_snapshot(snapshot())
        base_payload = {
            "snapshot": prepared,
            "horizon": "Swing",
            "research_depth": "standard",
            "asset_type": "equity",
            "expected_fingerprint": adapter.config.fingerprint,
        }

        malformed = dict(base_payload, unknown=True)
        response = asyncio.run(post(app, "/v1/analyze", malformed))
        self.assertEqual(response.status_code, 422)

        unbounded = dict(base_payload, snapshot=snapshot())
        response = asyncio.run(post(app, "/v1/analyze", unbounded))
        self.assertEqual(response.status_code, 422)

        sensitive_snapshot = dict(prepared)
        sensitive_snapshot["market"] = {
            **prepared["market"],
            "access_token": "not-allowed",
        }
        sensitive = dict(base_payload, snapshot=sensitive_snapshot)
        response = asyncio.run(post(app, "/v1/analyze", sensitive))
        self.assertEqual(response.status_code, 422)
        self.assertEqual(adapter.calls, 0)

    def test_worker_is_loopback_only_and_has_no_broker_state(self) -> None:
        self.assertFalse(hasattr(ai_worker, "fyers"))
        self.assertFalse(hasattr(ai_worker, "broker"))
        adapter = FakeAdapter()
        app = create_app(adapter)
        payload = {
            "snapshot": bounded_snapshot(snapshot()),
            "horizon": "Swing",
            "research_depth": "standard",
            "asset_type": "equity",
            "expected_fingerprint": adapter.config.fingerprint,
        }

        response = asyncio.run(
            post(app, "/v1/analyze", payload, client_host="203.0.113.10")
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(adapter.calls, 0)

    def test_worker_returns_bounded_structured_analysis_only_result(self) -> None:
        adapter = FakeAdapter()
        app = create_app(adapter)
        prepared = bounded_snapshot(snapshot())
        transport = httpx.ASGITransport(
            app=app,
            client=("127.0.0.1", 50000),
        )
        client = AIWorkerClient(
            config=adapter.config,
            worker_url="http://127.0.0.1:8124",
            transport=transport,
        )

        result = asyncio.run(
            client.analyze(snapshot(), "Swing", "standard", "equity")
        )

        self.assertEqual(adapter.calls, 1)
        self.assertEqual(adapter.snapshots, [prepared])
        self.assertEqual(result.signal_type, "analysis_only")
        self.assertFalse(result.execution_enabled)
        self.assertEqual(result.signal.value, "HOLD")
        self.assertEqual(result.confidence, 60)


if __name__ == "__main__":
    unittest.main()
