from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class AssetType(str, Enum):
    EQUITY = "equity"
    FNO = "fno"
    CRYPTO = "crypto"


class AnalysisSignal(str, Enum):
    STRONG_BUY = "STRONG BUY"
    BUY = "BUY"
    HOLD = "HOLD"
    SELL = "SELL"
    STRONG_SELL = "STRONG SELL"
    NO_CLEAR_SETUP = "NO CLEAR SETUP"


class AnalysisRequest(BaseModel):
    asset_type: AssetType
    symbol: str = Field(min_length=2, max_length=80)
    horizon: str = Field(min_length=2, max_length=40)
    research_depth: Literal["quick", "standard", "deep"] = "standard"
    resolution: str | None = None
    expiry: str | None = None
    ai_requested: bool = True


class AgentEvidence(BaseModel):
    agent: str
    status: Literal["available", "unavailable"] = "available"
    conclusion: str
    evidence: list[str] = Field(default_factory=list)


class AnalysisResult(BaseModel):
    instrument: dict[str, Any]
    asset_type: AssetType
    horizon: str
    signal: AnalysisSignal
    confidence: int = Field(ge=0, le=100)
    signal_type: Literal["analysis_only"] = "analysis_only"
    execution_enabled: Literal[False] = False
    market_bias: Literal["BULLISH", "BEARISH", "NEUTRAL"]
    technical_condition: str
    fundamental_condition: str
    sentiment_news_condition: str
    futures_confirmation: str | None = None
    options_oi_confirmation: str | None = None
    volatility: str
    volume_condition: str
    bullish_evidence: list[str]
    bearish_evidence: list[str]
    risks: list[str]
    important_levels: dict[str, float | None]
    important_strikes: list[float] = Field(default_factory=list)
    invalidation_conditions: list[str]
    reasoning_summary: str
    agents: list[AgentEvidence]
    data_timestamp: str
    generated_at: str
    data_freshness: Literal["REAL TIME", "DELAYED", "HISTORICAL", "CACHED"]
    data_sources: list[str]
    snapshot_id: str
    research_depth: str
    model: str
    cached: bool = False
    analysis_mode: Literal["deterministic", "llm"] = "deterministic"
    ai_status: Literal["disabled", "completed", "unavailable"] = "disabled"
    cost_notice: str = "Local deterministic analysis; no LLM inference used."


class ExecutionAttempt(BaseModel):
    signal: str | None = None
    symbol: str | None = None
    quantity: float | None = None
    action: str | None = None
