"""Optional, snapshot-only integration with TradingAgents v0.5.2.

Only TradingAgents' provider factory and structured-output helper are used.
Its data tools, trader, portfolio manager, and execution graph are deliberately
outside this adapter's capability boundary.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
from dataclasses import dataclass
from enum import Enum
from importlib.metadata import PackageNotFoundError, version
from collections.abc import Awaitable, Callable
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, create_model

from .models import AnalysisSignal


PINNED_TRADINGAGENTS_VERSION = "0.5.2"
PINNED_TRADINGAGENTS_COMMIT = "5eb50854dad299381861632aa34014448b4260fc"
FORBIDDEN_EXECUTION = re.compile(
    r"\b(execute|place|submit|cancel|modify|square\s*off|buy\s+\d+|sell\s+\d+|"
    r"shares?|contracts?|quantity|wallet|withdraw|broker\s+order|exchange\s+order)\b",
    re.IGNORECASE,
)
NUMBER = re.compile(r"(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])")
FORBIDDEN_EXTERNAL_FACTS = re.compile(
    r"\b(news|headlines?|fundamentals?|earnings|revenue|balance\s+sheet|"
    r"analyst\s+ratings?|social\s+sentiment)\b",
    re.IGNORECASE,
)


class TradingAgentsUnavailable(RuntimeError):
    pass


class TradingAgentsOutputRejected(RuntimeError):
    pass


QualitativeText = Annotated[str, StringConstraints(min_length=1, max_length=180)]
SnapshotEvidenceRef = Annotated[str, StringConstraints(min_length=1, max_length=200)]


class SpecialistRole(str, Enum):
    TECHNICAL = "technical"
    BULL = "bull"
    BEAR = "bear"
    RISK = "risk"


class SpecialistDirection(str, Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"
    MIXED = "mixed"


class SpecialistStrength(str, Enum):
    WEAK = "weak"
    MODERATE = "moderate"
    STRONG = "strong"


class RiskFlag(str, Enum):
    CONFLICTING_SIGNALS = "conflicting_signals"
    DATA_UNAVAILABLE = "data_unavailable"
    ELEVATED_VOLATILITY = "elevated_volatility"
    EXPIRY_PROXIMITY = "expiry_proximity"
    IV_UNAVAILABLE = "iv_unavailable"
    LIQUIDITY = "liquidity"
    OI_CHANGE_UNAVAILABLE = "oi_change_unavailable"
    OI_CONCENTRATION = "oi_concentration"
    STALE_DATA = "stale_data"


class SpecialistOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: SpecialistRole
    direction: SpecialistDirection
    strength: SpecialistStrength
    evidence_refs: list[SnapshotEvidenceRef] = Field(min_length=1, max_length=3)
    conflict_refs: list[SnapshotEvidenceRef] = Field(min_length=0, max_length=2)
    risk_flags: list[RiskFlag] = Field(min_length=0, max_length=3)


class FinalAIOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    signal_type: Literal["analysis_only"]
    execution_enabled: Literal[False]
    signal: AnalysisSignal
    confidence: int = Field(strict=True, ge=0, le=100)


ROLE_KEYS = {
    "Technical Analyst": SpecialistRole.TECHNICAL,
    "Bull Researcher": SpecialistRole.BULL,
    "Bear Researcher": SpecialistRole.BEAR,
    "Risk Analyst": SpecialistRole.RISK,
}
FINAL_REASONING = {
    AnalysisSignal.STRONG_BUY: "The validated specialist evidence supports a strongly bullish analysis.",
    AnalysisSignal.BUY: "The validated specialist evidence supports a bullish analysis.",
    AnalysisSignal.HOLD: "The validated specialist evidence supports a mixed analysis.",
    AnalysisSignal.SELL: "The validated specialist evidence supports a bearish analysis.",
    AnalysisSignal.STRONG_SELL: "The validated specialist evidence supports a strongly bearish analysis.",
    AnalysisSignal.NO_CLEAR_SETUP: "The validated specialist evidence does not support a clear directional analysis.",
}



class AIOverlay(BaseModel):
    signal: AnalysisSignal
    confidence: int
    technical_summary: str
    bull_case: list[str]
    bear_case: list[str]
    risks: list[str]
    reasoning_summary: str
    agents: list[dict[str, Any]]
    provider: str
    model: str
    cost_notice: str


@dataclass(frozen=True)
class TradingAgentsConfig:
    enabled: bool
    provider: str
    model: str
    base_url: str | None
    timeout_seconds: float
    max_retries: int
    max_tokens: int

    @classmethod
    def from_environment(cls) -> "TradingAgentsConfig":
        provider = os.getenv("LLM_PROVIDER", "").strip().lower()
        model = os.getenv("LLM_MODEL", "").strip()
        enabled = os.getenv("AI_ANALYSIS_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
        base_url = os.getenv("LLM_BASE_URL") or os.getenv("OLLAMA_BASE_URL")
        timeout_ceiling = 900.0 if provider in {"ollama", "openai_compatible"} else 300.0
        return cls(
            enabled=enabled and bool(provider and model),
            provider=provider,
            model=model,
            base_url=base_url,
            timeout_seconds=max(5.0, min(float(os.getenv("LLM_TIMEOUT_SECONDS", "90")), timeout_ceiling)),
            max_retries=max(0, min(int(os.getenv("LLM_MAX_RETRIES", "1")), 5)),
            max_tokens=max(256, min(int(os.getenv("LLM_MAX_TOKENS", "1800")), 8000)),
        )

    @property
    def cost_notice(self) -> str:
        if self.provider in {"ollama", "openai_compatible"}:
            return "LOCAL/FREE MODEL — no external inference charge from this application."
        return "EXTERNAL API MODEL — provider charges or quotas may apply. Run only when explicitly requested."

    @property
    def fingerprint(self) -> str:
        raw = (
            f"{PINNED_TRADINGAGENTS_VERSION}:{PINNED_TRADINGAGENTS_COMMIT}:"
            f"{self.provider}:{self.model}:{self.base_url or ''}:{self.max_tokens}"
        )
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12]


def _bounded_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    chain = snapshot.get("chain") if isinstance(snapshot.get("chain"), list) else []
    futures = snapshot.get("futures") if isinstance(snapshot.get("futures"), dict) else {}
    option_summary = {
        "row_count": len(chain),
        "important_strikes": snapshot.get("important_strikes", []),
    }
    futures_summary = {
        key: futures.get(key)
        for key in ("instrument", "market", "indicators", "data_timestamp", "data_freshness", "reason")
        if key in futures
    }
    return {
        "instrument": snapshot.get("instrument", {}),
        "market": snapshot.get("market", {}),
        "indicators": snapshot.get("indicators", {}),
        "futures": futures_summary,
        "options": option_summary,
        "data_timestamp": snapshot.get("data_timestamp"),
        "data_freshness": snapshot.get("data_freshness"),
        "data_sources": snapshot.get("data_sources", []),
    }


DIRECTIONAL_INDICATORS = {
    "atr14", "candle_confirmed", "candle_direction", "direction", "ema20", "ema50",
    "macd", "macd_signal", "resistance", "rsi14", "sma20", "support", "trend",
    "volume_condition", "volume_ratio", "vwap",
}
RISK_INDICATORS = {
    "atr14", "available", "bollinger_lower", "bollinger_upper", "candle_confirmed",
    "fresh", "last_candle_ts", "trend", "direction", "volume_condition", "volume_ratio",
}
TECHNICAL_MARKET = {
    "atm", "change", "change_percent", "high", "last_price", "low", "open", "pcr",
    "previous_close", "spot", "volume",
}
RESEARCH_MARKET = TECHNICAL_MARKET | {"ce_oi", "pe_oi"}
FUTURES_INSTRUMENT = {"contract_symbol", "expiry"}
FUTURES_TECHNICAL_MARKET = {"basis", "basis_percent", "futures_price", "spot_price"}
FUTURES_RESEARCH_MARKET = FUTURES_TECHNICAL_MARKET | {
    "change_in_open_interest", "days_to_expiry", "open_interest", "premium_discount",
}
FUTURES_RISK_MARKET = {
    "basis_percent", "change_in_open_interest", "days_to_expiry", "high", "low",
    "open_interest", "volume",
}
FUTURES_TECHNICAL_INDICATORS = {
    "ema20", "ema50", "macd", "macd_signal", "rsi14", "trend",
}
FUTURES_RISK_INDICATORS = {
    "atr14", "available", "trend", "volume_ratio",
}


def _pick(mapping: Any, keys: set[str]) -> dict[str, Any]:
    if not isinstance(mapping, dict):
        return {}
    return {key: mapping[key] for key in mapping if key in keys}


def _role_bounded_snapshot(bounded: dict[str, Any], name: str) -> dict[str, Any]:
    """Return the compact, neutral evidence set required by one specialist role."""
    role = ROLE_KEYS[name]
    market = bounded.get("market") if isinstance(bounded.get("market"), dict) else {}
    indicators = bounded.get("indicators") if isinstance(bounded.get("indicators"), dict) else {}
    futures = bounded.get("futures") if isinstance(bounded.get("futures"), dict) else {}
    futures_market = futures.get("market") if isinstance(futures.get("market"), dict) else {}
    futures_indicators = futures.get("indicators") if isinstance(futures.get("indicators"), dict) else {}
    options = bounded.get("options") if isinstance(bounded.get("options"), dict) else {}

    result: dict[str, Any] = {
        "instrument": _pick(
            bounded.get("instrument"),
            {"asset_type", "expiry", "symbol", "underlying"},
        ),
        "market": _pick(
            market,
            TECHNICAL_MARKET if role is SpecialistRole.TECHNICAL else RESEARCH_MARKET,
        ),
        "indicators": _pick(
            indicators,
            RISK_INDICATORS if role is SpecialistRole.RISK else DIRECTIONAL_INDICATORS,
        ),
    }
    if role is SpecialistRole.RISK:
        result["data_freshness"] = bounded.get("data_freshness")
        result["data_timestamp"] = bounded.get("data_timestamp")
    if role in {SpecialistRole.BULL, SpecialistRole.BEAR, SpecialistRole.RISK}:
        if options.get("row_count") or options.get("important_strikes"):
            result["options"] = options

    if role is SpecialistRole.TECHNICAL:
        future_market_keys = FUTURES_TECHNICAL_MARKET
        future_indicator_keys = FUTURES_TECHNICAL_INDICATORS
    elif role in {SpecialistRole.BULL, SpecialistRole.BEAR}:
        future_market_keys = FUTURES_RESEARCH_MARKET
        future_indicator_keys = FUTURES_TECHNICAL_INDICATORS
    else:
        future_market_keys = FUTURES_RISK_MARKET
        future_indicator_keys = FUTURES_RISK_INDICATORS

    future_summary = {
        "instrument": _pick(futures.get("instrument"), FUTURES_INSTRUMENT),
        "market": _pick(futures_market, future_market_keys),
        "indicators": _pick(futures_indicators, future_indicator_keys),
    }
    if role is SpecialistRole.RISK:
        for key in ("data_timestamp", "data_freshness", "reason"):
            if key in futures:
                future_summary[key] = futures[key]
    if any(value not in ({}, None, "") for value in future_summary.values()):
        result["futures"] = future_summary
    return result

def _flatten(value: Any, path: str = "snapshot") -> dict[str, Any]:
    result: dict[str, Any] = {}
    if isinstance(value, dict):
        for key, child in value.items():
            result.update(_flatten(child, f"{path}.{key}"))
    elif isinstance(value, list):
        for index, child in enumerate(value[:20]):
            result.update(_flatten(child, f"{path}[{index}]"))
    else:
        result[path] = value
    return result


def _resolve_evidence(flat_snapshot: dict[str, Any], refs: list[str]) -> list[dict[str, Any]]:
    """Resolve validated snapshot paths without evaluation or dynamic object traversal."""
    resolved: list[dict[str, Any]] = []
    for ref in dict.fromkeys(refs):
        if ref not in flat_snapshot:
            raise TradingAgentsOutputRejected("AI output cited evidence not present in the prepared snapshot")
        resolved.append({"path": ref, "value": flat_snapshot[ref]})
    return resolved


def _bounded_specialist_schema(allowed_refs: set[str], name: str) -> type[SpecialistOutput]:
    """Expose each valid role path once in the provider schema."""
    evidence_enum = Enum(
        f"{ROLE_KEYS[name].value.title()}EvidenceRef",
        {f"REF_{index}": ref for index, ref in enumerate(sorted(allowed_refs))},
        type=str,
    )
    return create_model(
        f"Bounded{ROLE_KEYS[name].value.title()}SpecialistOutput",
        __base__=SpecialistOutput,
        evidence_refs=(
            list[evidence_enum],
            Field(..., min_length=1, max_length=3),
        ),
        conflict_refs=(
            list[evidence_enum],
            Field(..., min_length=0, max_length=2),
        ),
    )


def _specialist_payload(output: SpecialistOutput, flat_snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "role": output.role.value,
        "direction": output.direction.value,
        "strength": output.strength.value,
        "evidence": {
            item["path"]: item["value"]
            for item in _resolve_evidence(flat_snapshot, output.evidence_refs)
        },
        "conflicts": {
            item["path"]: item["value"]
            for item in _resolve_evidence(flat_snapshot, output.conflict_refs)
        },
        "risk_flags": [flag.value for flag in output.risk_flags],
    }


def _specialist_summary(name: str, output: SpecialistOutput) -> str:
    summary = f"{name}: {output.strength.value} {output.direction.value} structured interpretation."
    if output.risk_flags:
        flags = ", ".join(flag.value.replace("_", " ") for flag in output.risk_flags)
        summary += f" Risk flags: {flags}."
    return summary


def _render_evidence(entries: list[dict[str, Any]], prefix: str = "") -> list[str]:
    return [
        f"{prefix}{entry['path']} = "
        f"{json.dumps(entry['value'], ensure_ascii=True, separators=(',', ':'), default=str)}"
        for entry in entries
    ]


def _apply_ollama_token_limit(llm: Any, provider: str, max_tokens: int) -> Any:
    """Keep Ollama's OpenAI endpoint from ignoring LangChain's renamed cap."""
    if provider == "ollama" and hasattr(llm, "extra_body"):
        llm.extra_body = {**(getattr(llm, "extra_body", None) or {}), "max_tokens": max_tokens}
    return llm


class TradingAgentsAdapter:
    def __init__(
        self,
        config: TradingAgentsConfig | None = None,
        llm: Any | None = None,
        structured_runner: Callable[[type[BaseModel], str, str], Awaitable[Any]] | None = None,
    ) -> None:
        self.config = config or TradingAgentsConfig.from_environment()
        self._llm = llm
        self._structured_runner = structured_runner

    def status(self) -> dict[str, Any]:
        return {
            "enabled": self.config.enabled,
            "provider": self.config.provider or "not configured",
            "model": self.config.model or "not configured",
            "framework": f"TradingAgents {PINNED_TRADINGAGENTS_VERSION}",
            "commit": PINNED_TRADINGAGENTS_COMMIT,
            "cost_notice": self.config.cost_notice if self.config.provider else "No LLM configured; deterministic analysis remains available.",
        }

    def _get_llm(self) -> Any:
        if self._llm is not None:
            return self._llm
        if not self.config.enabled:
            raise TradingAgentsUnavailable("Optional AI analysis is not configured")
        try:
            installed = version("tradingagents")
        except PackageNotFoundError as exc:
            raise TradingAgentsUnavailable("Pinned TradingAgents package is not installed") from exc
        if installed != PINNED_TRADINGAGENTS_VERSION:
            raise TradingAgentsUnavailable(
                f"TradingAgents {PINNED_TRADINGAGENTS_VERSION} is required; found {installed}"
            )
        try:
            from tradingagents.llm_clients.factory import build_llm_kwargs, create_llm_client

            kwargs = build_llm_kwargs({
                "llm_provider": self.config.provider,
                "llm_max_retries": self.config.max_retries,
                "max_tokens": self.config.max_tokens,
                "temperature": 0.0,
            })
            client = create_llm_client(
                self.config.provider,
                self.config.model,
                self.config.base_url,
                timeout=self.config.timeout_seconds,
                **kwargs,
            )
            self._llm = _apply_ollama_token_limit(
                client.get_llm(), self.config.provider, self.config.max_tokens
            )
            return self._llm
        except Exception as exc:
            raise TradingAgentsUnavailable("TradingAgents LLM provider could not be initialized") from exc

    @staticmethod
    def _validate_refs(refs: list[str], allowed: set[str]) -> None:
        unknown = sorted(set(refs) - allowed)
        if unknown:
            raise TradingAgentsOutputRejected("AI output cited evidence not present in the prepared snapshot")

    @staticmethod
    def _validate_text(texts: list[str], snapshot_values: list[Any]) -> None:
        combined = " ".join(texts)
        if FORBIDDEN_EXECUTION.search(combined):
            raise TradingAgentsOutputRejected("AI output contained executable trading language")
        if FORBIDDEN_EXTERNAL_FACTS.search(combined):
            raise TradingAgentsOutputRejected("AI output contained an unavailable external fact category")
        if NUMBER.search(combined):
            raise TradingAgentsOutputRejected(
                "AI interpretation prose must remain digit-free; values are rendered from evidence"
            )

    async def _invoke(self, schema: type[BaseModel], prompt: str, name: str) -> BaseModel:
        if self._structured_runner is not None:
            try:
                raw = await self._structured_runner(schema, prompt, name)
                return schema.model_validate(raw.model_dump() if isinstance(raw, BaseModel) else raw)
            except Exception as exc:
                raise TradingAgentsOutputRejected(f"{name} returned invalid structured output") from exc
        llm = self._get_llm()
        try:
            from tradingagents.agents.structured import bind_structured, invoke_structured

            structured = bind_structured(llm, schema, name)
            if self.config.provider in {"ollama", "openai_compatible"}:
                try:
                    structured = llm.with_structured_output(schema, method="json_schema")
                except (NotImplementedError, AttributeError, TypeError):
                    pass
            if structured is None:
                raise TradingAgentsOutputRejected("Configured model does not support strict structured output")
            raw = await asyncio.to_thread(invoke_structured, structured, prompt, name)
            if raw is None:
                raise TradingAgentsOutputRejected("Model did not return valid structured output")
            return schema.model_validate(raw.model_dump() if isinstance(raw, BaseModel) else raw)
        except TradingAgentsOutputRejected:
            raise
        except Exception as exc:
            raise TradingAgentsUnavailable(f"{name} failed") from exc

    async def analyze(
        self,
        snapshot: dict[str, Any],
        horizon: str,
        depth: str,
        asset_type: str | None = None,
    ) -> AIOverlay:
        if not self.config.enabled:
            raise TradingAgentsUnavailable("Optional AI analysis is disabled")

        bounded = _bounded_snapshot(snapshot)
        flat = _flatten(bounded)
        role_snapshots = {
            name: _role_bounded_snapshot(bounded, name)
            for name in ROLE_KEYS
        }
        role_flats = {
            name: _flatten(role_snapshot)
            for name, role_snapshot in role_snapshots.items()
        }
        role_schemas = {
            name: _bounded_specialist_schema(set(role_flats[name]), name)
            for name in ROLE_KEYS
        }
        specialist_rules = (
            "Use only Snapshot JSON. No tools, outside facts, news, fundamentals, sentiment, "
            "orders, quantities, entries, exits, or execution. Return only the schema fields; "
            "do not generate prose or numeric market values. Copy evidence_refs and conflict_refs exactly from paths present in "
            "Snapshot; every path begins with snapshot. Never infer a common field name: verify that each exact key is visibly present before citing it. Missing facts remain unavailable."
        )
        role_guidance = {
            "Technical Analyst": "Assess trend, momentum, volatility, volume, support, and resistance.",
            "Bull Researcher": "Build the strongest bullish interpretation of the neutral evidence without suppressing conflicts.",
            "Bear Researcher": "Build the strongest bearish interpretation of the neutral evidence without suppressing conflicts.",
            "Risk Analyst": "Assess volatility, freshness, conflicts, expiry, concentration, missing fields, and data quality.",
        }
        role_prompts = {
            name: (
                f"{specialist_rules}\nRole must be {ROLE_KEYS[name].value}. "
                f"{role_guidance[name]}\nHorizon: {horizon}\nSnapshot:"
                f"{json.dumps(role_snapshots[name], sort_keys=True, separators=(',', ':'), default=str)}"
            )
            for name in ROLE_KEYS
        }
        selected = ["Technical Analyst", "Risk Analyst"] if depth == "quick" else list(role_prompts)

        async def run_role(name: str, prompt: str) -> tuple[str, SpecialistOutput]:
            raw_output = await self._invoke(role_schemas[name], prompt, name)
            output = SpecialistOutput.model_validate(
                raw_output.model_dump(mode="json")
                if isinstance(raw_output, BaseModel)
                else raw_output
            )
            if output.role is not ROLE_KEYS[name]:
                raise TradingAgentsOutputRejected(f"{name} returned the wrong specialist role")
            refs = [*output.evidence_refs, *output.conflict_refs]
            allowed_refs = set(role_flats[name])
            self._validate_refs(refs, allowed_refs)
            _resolve_evidence(role_flats[name], refs)
            output = output.model_copy(update={
                "evidence_refs": list(dict.fromkeys(output.evidence_refs)),
                "conflict_refs": list(dict.fromkeys(output.conflict_refs)),
                "risk_flags": list(dict.fromkeys(output.risk_flags)),
            })
            return name, output

        if self.config.provider in {"ollama", "openai_compatible"}:
            specialist_pairs = []
            for name in selected:
                specialist_pairs.append(await asyncio.wait_for(
                    run_role(name, role_prompts[name]),
                    timeout=self.config.timeout_seconds,
                ))
        else:
            specialist_pairs = await asyncio.wait_for(
                asyncio.gather(*(run_role(name, role_prompts[name]) for name in selected)),
                timeout=self.config.timeout_seconds,
            )
        specialists = dict(specialist_pairs)

        if depth == "deep":
            for name in ("Bull Researcher", "Bear Researcher"):
                counter = "Bear Researcher" if name == "Bull Researcher" else "Bull Researcher"
                opposing = specialists[counter].model_dump(mode="json")
                prompt = (
                    role_prompts[name]
                    + "\nCritically address this opposing validated specialist structure:"
                    + json.dumps(opposing, sort_keys=True, separators=(",", ":"))
                )
                _, specialists[name] = await run_role(name, prompt)

        specialist_payload = {
            name: _specialist_payload(output, role_flats[name])
            for name, output in specialists.items()
        }
        inferred_asset_type = (
            asset_type
            or str((bounded.get("instrument") or {}).get("asset_type") or "unknown")
        )
        final_context = {
            "asset_type": inferred_asset_type,
            "horizon": horizon,
            "data_freshness": bounded.get("data_freshness"),
            "specialists": specialist_payload,
        }
        final_prompt = (
            "Use only FinalContext. It contains validated specialist structure and authoritative "
            "snapshot values only for cited evidence. Do not add outside facts, news, fundamentals, "
            "sources, evidence paths, market values, orders, or execution instructions. "
            "signal_type must be analysis_only and execution_enabled must be false. "
            "Allowed signals: STRONG BUY, BUY, HOLD, SELL, STRONG SELL, NO CLEAR SETUP. "
            "confidence is the ONE numeric value you must generate: an analytical evidence-strength "
            "score from zero to one hundred. It is not probability of profit, predicted return, win "
            "probability, or certainty of future movement. Do not generate any other numeric value. "
            "A genuine confidence of zero remains valid.\nFinalContext:"
            + json.dumps(final_context, sort_keys=True, separators=(",", ":"), default=str)
        )
        final = FinalAIOutput.model_validate(await asyncio.wait_for(
            self._invoke(FinalAIOutput, final_prompt, "Final Analysis Agent"),
            timeout=self.config.timeout_seconds,
        ))

        combined_refs = list(dict.fromkeys(
            ref
            for output in specialists.values()
            for ref in [*output.evidence_refs, *output.conflict_refs]
        ))[:6]
        final_evidence = _render_evidence(_resolve_evidence(flat, combined_refs))
        agents = []
        for name, output in specialists.items():
            evidence = _render_evidence(
                _resolve_evidence(role_flats[name], output.evidence_refs)
            )
            evidence.extend(_render_evidence(
                _resolve_evidence(role_flats[name], output.conflict_refs),
                prefix="Conflict: ",
            ))
            agents.append({
                "agent": name,
                "status": "available",
                "conclusion": _specialist_summary(name, output),
                "evidence": evidence,
            })
        agents.append({
            "agent": "Final Analysis Agent",
            "status": "available",
            "conclusion": f"{final.signal.value} ({final.confidence}/100)",
            "evidence": final_evidence,
        })

        summaries = {
            name: _specialist_summary(name, output)
            for name, output in specialists.items()
        }
        return AIOverlay(
            signal=final.signal,
            confidence=final.confidence,
            technical_summary=summaries["Technical Analyst"],
            bull_case=[summaries["Bull Researcher"]] if "Bull Researcher" in summaries else ["Unavailable at quick research depth."],
            bear_case=[summaries["Bear Researcher"]] if "Bear Researcher" in summaries else ["Unavailable at quick research depth."],
            risks=[summaries["Risk Analyst"]],
            reasoning_summary=FINAL_REASONING[final.signal],
            agents=agents,
            provider=self.config.provider,
            model=self.config.model,
            cost_notice=self.config.cost_notice,
        )
