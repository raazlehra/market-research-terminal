from __future__ import annotations

from dataclasses import asdict, dataclass, field, is_dataclass
from datetime import datetime
import math
from typing import Any, Literal, cast

BacktestStrategy = Literal["VOLUME_SPIKE", "BREAKOUT_VOLUME", "BREAKOUT", "EMA_CROSS", "VWAP_BREAKOUT"]
TradeSide = Literal["BUY", "SELL"]
ExitReason = Literal["STOP", "TARGET", "SESSION_END", "MAX_HOLDING", "NO_EXIT"]

SCHEMA_VERSION = "backtesting.v1"
CODE_VERSION = "phase2.slice1"


@dataclass(frozen=True)
class NormalizedCandle:
    symbol: str
    resolution: str
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float

    @property
    def epoch(self) -> int:
        return int(self.timestamp.timestamp())

    def scanner_row(self) -> list[float]:
        return [float(self.epoch), self.open, self.high, self.low, self.close, self.volume]


@dataclass(frozen=True)
class Rejection:
    row_number: int
    reason: str


@dataclass(frozen=True)
class CsvLoadReport:
    accepted: int
    rejected: int
    duplicate_count: int
    rejections: list[Rejection]
    dataset_fingerprint: str


@dataclass(frozen=True)
class ExecutionPolicy:
    entry: Literal["next_candle_open"] = "next_candle_open"
    exit: Literal["stop_target_session_end"] = "stop_target_session_end"
    fixed_quantity: int = 1
    slippage_bps: float = 5.0
    max_holding_bars: int = 20
    no_overnight: bool = True
    same_candle_tie_breaker: Literal["stop_first"] = "stop_first"
    target_gap_policy: Literal["target_price"] = "target_price"
    stop_gap_policy: Literal["worse_of_stop_or_open"] = "worse_of_stop_or_open"
    allow_overlapping_positions: bool = False


@dataclass(frozen=True)
class CostConfig:
    model: Literal["paper_equity_v1"] = "paper_equity_v1"
    historical_schedule_modelled: bool = False


@dataclass(frozen=True)
class BacktestConfig:
    strategy: BacktestStrategy
    symbols: list[str]
    resolution: str
    start: datetime | None = None
    end: datetime | None = None
    score_threshold: float = 50.0
    execution: ExecutionPolicy = field(default_factory=ExecutionPolicy)
    costs: CostConfig = field(default_factory=CostConfig)
    run_id: str | None = None
    seed: int | None = None
    strategy_params: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SignalRecord:
    symbol: str
    strategy: str
    side: TradeSide
    decision_time: datetime
    entry_time: datetime | None
    signal: str
    score: float
    score_type: str
    calibrated: bool
    score_range: list[int]
    entry: float
    sl: float
    t1: float
    t2: float
    factors: dict[str, Any]
    breakdown: list[dict[str, Any]]
    unsupported_reason: str | None = None


@dataclass(frozen=True)
class TradeRecord:
    run_id: str
    symbol: str
    strategy: str
    side: TradeSide
    signal_time: datetime
    entry_time: datetime
    exit_time: datetime
    entry_price: float
    exit_price: float
    qty: int
    exit_reason: ExitReason
    entry_notional: float
    gross_pnl: float
    entry_charges: float
    exit_charges: float
    total_charges: float
    net_pnl: float
    gross_return_pct: float | None
    net_return_pct: float | None
    initial_risk: float | None
    r_multiple: float | None
    mae: float
    mfe: float
    holding_bars: int
    holding_seconds: int
    score: float
    signal: str
    score_breakdown: list[dict[str, Any]]


@dataclass(frozen=True)
class EquityCurvePoint:
    timestamp: datetime
    equity: float
    drawdown: float


@dataclass(frozen=True)
class MetricsSummary:
    trade_count: int
    gross_pnl: float
    total_charges: float
    net_pnl: float
    entry_notional: float
    gross_return_pct: float | None
    net_return_pct: float | None
    win_rate: float | None
    loss_rate: float | None
    breakeven_count: int
    expectancy_net: float | None
    expectancy_r: float | None
    gross_profit: float
    gross_loss: float
    profit_factor: float | None
    profit_factor_basis: Literal["net_pnl"]
    max_drawdown: float
    longest_losing_streak: int


@dataclass(frozen=True)
class CalibrationBand:
    band: str
    low: int
    high: int
    observations: int
    wins: int
    losses: int
    breakeven: int
    win_rate: float | None
    avg_gross_return_pct: float | None
    avg_net_return_pct: float | None
    avg_r: float | None
    expectancy_net: float | None
    profit_factor: float | None
    warning: str | None


@dataclass(frozen=True)
class RunMetadata:
    run_id: str
    strategy: str
    symbols: list[str]
    resolution: str
    start: datetime | None
    end: datetime | None
    execution_policy: dict[str, Any]
    cost_config: dict[str, Any]
    score_threshold: float
    dataset_fingerprint: str
    run_config: dict[str, Any]
    schema_version: str
    code_version: str
    created_at: datetime
    warnings: list[str]
    unsupported_data_reasons: list[str]
    skipped_signal_count: int
    skipped_signal_reasons: list[str]


@dataclass(frozen=True)
class BacktestResult:
    metadata: RunMetadata
    load_report: CsvLoadReport
    signals: list[SignalRecord]
    trades: list[TradeRecord]
    metrics: MetricsSummary
    equity_curve: list[EquityCurvePoint]
    calibration_bands: list[CalibrationBand]


def to_jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if is_dataclass(value) and not isinstance(value, type):
        return {key: to_jsonable(item) for key, item in asdict(cast(Any, value)).items()}
    if isinstance(value, list):
        return [to_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    return value
