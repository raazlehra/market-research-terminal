import asyncio
import hashlib
import json
import os
import sys
import unittest
from types import ModuleType
from unittest.mock import patch

from backend.analysis.indicators import calculate_indicators
from backend.analysis.models import AnalysisRequest
from backend.analysis.service import AnalysisService
from backend.analysis.tradingagents_adapter import (
    FinalAIOutput,
    PINNED_TRADINGAGENTS_COMMIT,
    PINNED_TRADINGAGENTS_VERSION,
    RiskFlag,
    SpecialistDirection,
    SpecialistOutput,
    SpecialistRole,
    SpecialistStrength,
    TradingAgentsAdapter,
    TradingAgentsConfig,
    TradingAgentsOutputRejected,
    _apply_ollama_token_limit,
    _bounded_snapshot,
    _flatten,
    _resolve_evidence,
    _role_bounded_snapshot,
)


def snapshot() -> dict:
    candles = [
        {
            "timestamp": 1_800_000_000 + i * 3600,
            "open": 100 + i,
            "high": 102 + i,
            "low": 99 + i,
            "close": 101 + i,
            "volume": 1000 + i,
        }
        for i in range(80)
    ]
    return {
        "instrument": {"asset_type": "equity", "symbol": "NSE:TEST-EQ"},
        "market": {"last_price": 180},
        "candles": candles,
        "indicators": calculate_indicators(candles),
        "data_timestamp": "2026-10-02T00:00:00+00:00",
        "data_freshness": "REAL TIME",
        "data_sources": ["test snapshot"],
    }


ROLE_BY_NAME = {
    "Technical Analyst": "technical",
    "Bull Researcher": "bull",
    "Bear Researcher": "bear",
    "Risk Analyst": "risk",
}
DIRECTION_BY_NAME = {
    "Technical Analyst": "mixed",
    "Bull Researcher": "bullish",
    "Bear Researcher": "bearish",
    "Risk Analyst": "mixed",
}


def specialist_result(
    name: str,
    *,
    interpretation: str | None = None,
    evidence_refs: list[str] | None = None,
    conflict_refs: list[str] | None = None,
    risk_flags: list[str] | None = None,
) -> dict:
    result = {
        "role": ROLE_BY_NAME[name],
        "direction": DIRECTION_BY_NAME[name],
        "strength": "moderate",
        "evidence_refs": evidence_refs or ["snapshot.indicators.trend"],
        "conflict_refs": conflict_refs or [],
        "risk_flags": risk_flags or [],
    }
    if interpretation is not None:
        result["interpretation"] = interpretation
    return result


def config(timeout: float = 2) -> TradingAgentsConfig:
    return TradingAgentsConfig(True, "ollama", "local-test", None, timeout, 0, 512)


class FakeMarket:
    async def stock_snapshot(self, symbol: str, resolution: str, days: int):
        return snapshot()

    async def option_snapshot(self, symbol: str, expiry: str | None):
        return snapshot()


class FakeCrypto:
    async def market_snapshot(self, symbol: str, interval: str):
        return snapshot()


class TradingAgentsAdapterTests(unittest.TestCase):
    def test_config_fingerprint_includes_verified_release_commit(self) -> None:
        expected = hashlib.sha256(
            (
                "0.5.2:5eb50854dad299381861632aa34014448b4260fc:"
                "ollama:local-test::512"
            ).encode("utf-8")
        ).hexdigest()[:12]

        self.assertEqual(PINNED_TRADINGAGENTS_VERSION, "0.5.2")
        self.assertEqual(
            PINNED_TRADINGAGENTS_COMMIT,
            "5eb50854dad299381861632aa34014448b4260fc",
        )
        self.assertEqual(config().fingerprint, expected)

    def test_bounded_snapshot_excludes_raw_option_and_futures_candles(self) -> None:
        value = snapshot()
        value["chain"] = [{"strike": index} for index in range(50)]
        value["important_strikes"] = [100, 110]
        value["futures"] = {
            "instrument": {"contract_symbol": "NSE:TESTFUT"},
            "market": {"basis": 5},
            "indicators": {"trend": "BULLISH"},
            "candles": [{"close": index} for index in range(500)],
        }

        bounded = _bounded_snapshot(value)

        self.assertEqual(bounded["options"]["row_count"], 50)
        self.assertNotIn("chain", bounded)
        self.assertNotIn("candles", bounded["futures"])
        self.assertEqual(bounded["futures"]["market"]["basis"], 5)

    def test_role_specific_snapshot_bounds_fno_inputs(self) -> None:
        value = snapshot()
        value["instrument"]["asset_type"] = "fno"
        value["market"].update({"pcr": 1.1, "ce_oi": 10, "pe_oi": 11})
        value["chain"] = [{"strike": index} for index in range(41)]
        value["important_strikes"] = [100, 110]
        value["futures"] = {
            "instrument": {"contract_symbol": "NSE:TESTFUT"},
            "market": {
                "basis": 5,
                "days_to_expiry": 3,
                "high": 190,
                "low": 170,
                "open_interest": 1000,
            },
            "indicators": {"trend": "BULLISH", "macd": 2, "atr14": 4},
            "data_freshness": "REAL TIME",
            "data_timestamp": "2026-10-02T00:00:00+00:00",
        }
        bounded = _bounded_snapshot(value)

        technical = _role_bounded_snapshot(bounded, "Technical Analyst")
        bull = _role_bounded_snapshot(bounded, "Bull Researcher")
        risk = _role_bounded_snapshot(bounded, "Risk Analyst")

        self.assertNotIn("row_count", technical.get("options", {}))
        self.assertEqual(bull["options"]["row_count"], 41)
        self.assertIn("macd", technical["futures"]["indicators"])
        self.assertNotIn("macd", risk["futures"]["indicators"])
        self.assertEqual(risk["futures"]["market"]["days_to_expiry"], 3)
        self.assertEqual(risk["futures"]["market"]["high"], 190)

    def test_local_provider_allows_cpu_bound_timeout(self) -> None:
        with patch.dict(os.environ, {
            "AI_ANALYSIS_ENABLED": "true",
            "LLM_PROVIDER": "ollama",
            "LLM_MODEL": "local-test",
            "LLM_TIMEOUT_SECONDS": "600",
        }):
            local_config = TradingAgentsConfig.from_environment()

        self.assertEqual(local_config.timeout_seconds, 600.0)

    def test_specialist_schema_is_static_compact_and_strict(self) -> None:
        properties = set(SpecialistOutput.model_json_schema()["properties"])

        self.assertEqual(
            properties,
            {
                "role",
                "direction",
                "strength",
                "evidence_refs",
                "conflict_refs",
                "risk_flags",
            },
        )
        self.assertTrue(SpecialistOutput.model_config["extra"] == "forbid")
        self.assertLess(len(json.dumps(SpecialistOutput.model_json_schema())), 2500)

    def test_valid_specialist_enums_are_accepted(self) -> None:
        output = SpecialistOutput(
            role=SpecialistRole.TECHNICAL,
            direction=SpecialistDirection.BULLISH,
            strength=SpecialistStrength.STRONG,
            evidence_refs=["snapshot.indicators.trend"],
            conflict_refs=[],
            risk_flags=[RiskFlag.CONFLICTING_SIGNALS],
        )

        self.assertEqual(output.direction, SpecialistDirection.BULLISH)
        self.assertEqual(output.strength, SpecialistStrength.STRONG)

    def test_invalid_enum_numeric_prose_and_prefixless_refs_are_rejected(self) -> None:
        valid = specialist_result("Technical Analyst")
        for key, value in (("direction", "upward"), ("strength", "maximum")):
            malformed = {**valid, key: value}
            with self.assertRaises(ValueError):
                SpecialistOutput.model_validate(malformed)


    def test_risk_flags_are_enum_bounded_and_count_bounded(self) -> None:
        valid = specialist_result("Risk Analyst")
        with self.assertRaises(ValueError):
            SpecialistOutput.model_validate({
                **valid,
                "risk_flags": ["invented_risk"],
            })
        with self.assertRaises(ValueError):
            SpecialistOutput.model_validate({
                **valid,
                "risk_flags": ["stale_data"] * 5,
            })

    def test_safe_evidence_resolver_uses_only_flat_snapshot_map(self) -> None:
        flat = _flatten(_bounded_snapshot(snapshot()))

        resolved = _resolve_evidence(flat, ["snapshot.indicators.trend"])
        self.assertEqual(resolved[0]["value"], snapshot()["indicators"]["trend"])
        with self.assertRaises(TradingAgentsOutputRejected):
            _resolve_evidence(flat, ["snapshot.__class__.__mro__"])

    def test_local_provider_prefers_json_schema_structured_output(self) -> None:
        methods: list[str | None] = []

        class FakeStructured:
            def invoke(self, prompt: str):
                return specialist_result("Technical Analyst")

        class FakeLlm:
            def with_structured_output(self, schema, method=None, **kwargs):
                methods.append(method)
                return FakeStructured()

        structured_module = ModuleType("tradingagents.agents.structured")
        structured_module.bind_structured = lambda llm, schema, name: llm.with_structured_output(schema)
        structured_module.invoke_structured = (
            lambda structured, prompt, name: structured.invoke(prompt)
        )
        agents_module = ModuleType("tradingagents.agents")
        tradingagents_module = ModuleType("tradingagents")
        module_overrides = {
            "tradingagents": tradingagents_module,
            "tradingagents.agents": agents_module,
            "tradingagents.agents.structured": structured_module,
        }
        adapter = TradingAgentsAdapter(config(), llm=FakeLlm())
        with patch.dict(sys.modules, module_overrides):
            result = asyncio.run(
                adapter._invoke(SpecialistOutput, "snapshot", "Technical Analyst")
            )

        self.assertEqual(result.role, SpecialistRole.TECHNICAL)
        self.assertEqual(methods[-1], "json_schema")

    def test_ollama_receives_legacy_openai_token_cap(self) -> None:
        class FakeLlm:
            extra_body = {"keep_alive": "five minutes"}

        llm = _apply_ollama_token_limit(FakeLlm(), "ollama", 256)

        self.assertEqual(llm.extra_body, {"keep_alive": "five minutes", "max_tokens": 256})

    def test_final_schema_is_compact_and_forbids_unrequested_sources(self) -> None:
        properties = set(FinalAIOutput.model_json_schema()["properties"])

        self.assertEqual(
            properties,
            {"signal_type", "execution_enabled", "signal", "confidence"},
        )
        with self.assertRaises(ValueError):
            FinalAIOutput(
                signal_type="analysis_only",
                execution_enabled=False,
                signal="HOLD",
                confidence=50,
                sources=["invented source"],
            )

    def test_confidence_boundaries_propagate_and_invalid_values_fail(self) -> None:
        for value in (0, 1, 50, 100):
            output = FinalAIOutput(
                signal_type="analysis_only",
                execution_enabled=False,
                signal="HOLD",
                confidence=value,
            )
            self.assertEqual(output.confidence, value)

        for value in (-1, 101, "not numeric"):
            with self.assertRaises(ValueError):
                FinalAIOutput(
                    signal_type="analysis_only",
                    execution_enabled=False,
                    signal="HOLD",
                    confidence=value,
                )
        with self.assertRaises(ValueError):
            FinalAIOutput.model_validate({
                "signal_type": "analysis_only",
                "execution_enabled": False,
                "signal": "HOLD",
            })

    def test_snapshot_only_agents_preserve_structured_reasoning(self) -> None:
        prompts: list[tuple[str, str]] = []

        async def runner(schema, prompt: str, name: str):
            prompts.append((name, prompt))
            if issubclass(schema, SpecialistOutput):
                return specialist_result(name)
            return {
                "signal_type": "analysis_only",
                "execution_enabled": False,
                "signal": "HOLD",
                "confidence": 60,
            }

        result = asyncio.run(
            TradingAgentsAdapter(config(), structured_runner=runner).analyze(
                snapshot(), "Swing", "standard", "equity"
            )
        )

        self.assertEqual(result.signal.value, "HOLD")
        self.assertEqual(result.confidence, 60)
        self.assertEqual(len(result.agents), 5)
        self.assertIn("moderate mixed structured interpretation", result.technical_summary)
        self.assertIn("moderate bullish structured interpretation", result.bull_case[0])
        self.assertIn("moderate bearish structured interpretation", result.bear_case[0])
        self.assertTrue(all("broker" not in prompt.lower() and "access_token" not in prompt for _, prompt in prompts))
        self.assertTrue(all("Snapshot:" in prompt for _, prompt in prompts[:-1]))
        self.assertIn("FinalContext:", prompts[-1][1])
        self.assertNotIn("\nSnapshot:", prompts[-1][1])
        self.assertIn("confidence is the ONE numeric value", prompts[-1][1])
        self.assertIn('"snapshot.indicators.trend":"BULLISH"', prompts[-1][1])
        self.assertIn('snapshot.indicators.trend = "BULLISH"', result.agents[0]["evidence"])

    def test_final_receives_only_authoritative_referenced_values(self) -> None:
        final_prompts: list[str] = []

        async def runner(schema, prompt: str, name: str):
            if issubclass(schema, SpecialistOutput):
                return specialist_result(name, evidence_refs=["snapshot.market.last_price"])
            final_prompts.append(prompt)
            return {
                "signal_type": "analysis_only",
                "execution_enabled": False,
                "signal": "NO CLEAR SETUP",
                "confidence": 1,
            }

        result = asyncio.run(
            TradingAgentsAdapter(config(), structured_runner=runner).analyze(
                snapshot(), "Swing", "standard", "equity"
            )
        )

        self.assertEqual(result.confidence, 1)
        self.assertIn('"snapshot.market.last_price":180', final_prompts[0])
        self.assertNotIn("9999", final_prompts[0])

    def test_local_provider_serializes_specialists(self) -> None:
        active = 0
        peak = 0

        async def runner(schema, prompt: str, name: str):
            nonlocal active, peak
            if issubclass(schema, SpecialistOutput):
                active += 1
                peak = max(peak, active)
                await asyncio.sleep(0.01)
                active -= 1
                return specialist_result(name)
            return {
                "signal_type": "analysis_only",
                "execution_enabled": False,
                "signal": "HOLD",
                "confidence": 50,
            }

        result = asyncio.run(
            TradingAgentsAdapter(config(), structured_runner=runner).analyze(
                snapshot(), "Swing", "standard"
            )
        )

        self.assertEqual(peak, 1)
        self.assertEqual(len(result.agents), 5)

    def test_execution_enabled_true_is_rejected(self) -> None:
        async def runner(schema, prompt: str, name: str):
            if issubclass(schema, SpecialistOutput):
                return specialist_result(name)
            return {
                "signal_type": "analysis_only",
                "execution_enabled": True,
                "signal": "BUY",
                "confidence": 70,
            }

        with self.assertRaises(TradingAgentsOutputRejected):
            asyncio.run(
                TradingAgentsAdapter(config(), structured_runner=runner).analyze(
                    snapshot(), "Swing", "quick"
                )
            )

    def test_execution_language_is_rejected(self) -> None:
        async def runner(schema, prompt: str, name: str):
            if issubclass(schema, SpecialistOutput):
                return specialist_result(name, interpretation="Execute immediately.")
            raise AssertionError("final should not run")

        with self.assertRaises(TradingAgentsOutputRejected):
            asyncio.run(
                TradingAgentsAdapter(config(), structured_runner=runner).analyze(
                    snapshot(), "Swing", "quick"
                )
            )

    def test_unknown_evidence_news_and_fundamental_refs_are_rejected(self) -> None:
        bad_refs = [
            "indicators.trend",
            "snapshot.indicators.unknown",
            "snapshot.news.headline",
            "snapshot.fundamentals.revenue",
        ]
        for bad_ref in bad_refs:
            async def runner(schema, prompt: str, name: str, ref=bad_ref):
                if issubclass(schema, SpecialistOutput):
                    return specialist_result(name, evidence_refs=[ref])
                raise AssertionError("final should not run")

            with self.assertRaises(TradingAgentsOutputRejected):
                asyncio.run(
                    TradingAgentsAdapter(config(), structured_runner=runner).analyze(
                        snapshot(), "Swing", "quick"
                    )
                )

    def test_crypto_fundamental_and_unavailable_news_prose_are_rejected(self) -> None:
        crypto = snapshot()
        crypto["instrument"]["asset_type"] = "crypto"

        for interpretation in (
            "Corporate fundamentals are supportive.",
            "Recent news is constructive.",
        ):
            async def runner(schema, prompt: str, name: str, text=interpretation):
                if issubclass(schema, SpecialistOutput):
                    return specialist_result(name, interpretation=text)
                raise AssertionError("final should not run")

            with self.assertRaises(TradingAgentsOutputRejected):
                asyncio.run(
                    TradingAgentsAdapter(config(), structured_runner=runner).analyze(
                        crypto, "Swing", "quick", "crypto"
                    )
                )

    def test_malformed_numeric_and_unknown_source_outputs_are_rejected(self) -> None:
        async def malformed(schema, prompt: str, name: str):
            return {}

        with self.assertRaises(TradingAgentsOutputRejected):
            asyncio.run(
                TradingAgentsAdapter(config(), structured_runner=malformed).analyze(
                    snapshot(), "Swing", "quick"
                )
            )

        async def fabricated_number(schema, prompt: str, name: str):
            if issubclass(schema, SpecialistOutput):
                return specialist_result(name, interpretation="Momentum is 9999.")
            raise AssertionError("final should not run")

        with self.assertRaises(TradingAgentsOutputRejected):
            asyncio.run(
                TradingAgentsAdapter(config(), structured_runner=fabricated_number).analyze(
                    snapshot(), "Swing", "quick"
                )
            )

        async def unknown_source(schema, prompt: str, name: str):
            if issubclass(schema, SpecialistOutput):
                return specialist_result(name)
            return {
                "signal_type": "analysis_only",
                "execution_enabled": False,
                "signal": "HOLD",
                "confidence": 50,
                "sources": ["invented source"],
            }

        with self.assertRaisesRegex(TradingAgentsOutputRejected, "invalid structured output"):
            asyncio.run(
                TradingAgentsAdapter(config(), structured_runner=unknown_source).analyze(
                    snapshot(), "Swing", "quick"
                )
            )

    def test_wrong_specialist_role_is_rejected(self) -> None:
        async def runner(schema, prompt: str, name: str):
            if issubclass(schema, SpecialistOutput):
                result = specialist_result(name)
                result["role"] = "risk"
                return result
            raise AssertionError("final should not run")

        with self.assertRaises(TradingAgentsOutputRejected):
            asyncio.run(
                TradingAgentsAdapter(config(), structured_runner=runner).analyze(
                    snapshot(), "Swing", "quick"
                )
            )

    def test_timeout_and_provider_failure_fail_closed(self) -> None:
        async def slow(schema, prompt: str, name: str):
            await asyncio.sleep(0.1)
            return {}

        with self.assertRaises(asyncio.TimeoutError):
            asyncio.run(
                TradingAgentsAdapter(config(0.01), structured_runner=slow).analyze(
                    snapshot(), "Swing", "quick"
                )
            )

        async def failed(schema, prompt: str, name: str):
            raise RuntimeError("provider unavailable")

        with self.assertRaises(TradingAgentsOutputRejected):
            asyncio.run(
                TradingAgentsAdapter(config(), structured_runner=failed).analyze(
                    snapshot(), "Swing", "quick"
                )
            )

    def test_service_cache_prevents_duplicate_ai_runs(self) -> None:
        calls = 0

        async def runner(schema, prompt: str, name: str):
            nonlocal calls
            calls += 1
            if issubclass(schema, SpecialistOutput):
                return specialist_result(name)
            return {
                "signal_type": "analysis_only",
                "execution_enabled": False,
                "signal": "HOLD",
                "confidence": 55,
            }

        service = AnalysisService(
            FakeMarket(),
            FakeCrypto(),
            TradingAgentsAdapter(config(), structured_runner=runner),
        )
        request = AnalysisRequest(
            asset_type="equity",
            symbol="NSE:TEST-EQ",
            horizon="Swing",
            research_depth="quick",
        )
        first = asyncio.run(service.analyze(request))
        calls_after_first = calls
        second = asyncio.run(service.analyze(request))

        self.assertEqual(first.analysis_mode, "llm")
        self.assertTrue(second.cached)
        self.assertEqual(calls, calls_after_first)


if __name__ == "__main__":
    unittest.main()
