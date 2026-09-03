from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from backend.paper_engine.pricing import charges

from .schemas import CostConfig, TradeSide


@dataclass(frozen=True)
class CostBreakdown:
    entry_charges: float
    exit_charges: float
    total_charges: float


def apply_adverse_slippage(price: float, side: TradeSide, bps: float, action: Literal["ENTRY", "EXIT"]) -> float:
    adjustment = price * (max(bps, 0) / 10_000)
    if action == "ENTRY":
        return round(price + adjustment if side == "BUY" else price - adjustment, 6)
    return round(price - adjustment if side == "BUY" else price + adjustment, 6)


def equity_costs(entry_price: float, exit_price: float, qty: int, side: TradeSide, config: CostConfig) -> CostBreakdown:
    if config.model != "paper_equity_v1":
        raise ValueError(f"unsupported cost model: {config.model}")
    exit_side = "SELL" if side == "BUY" else "BUY"
    entry_charges = charges(entry_price, qty, side)
    exit_charges = charges(exit_price, qty, exit_side)
    return CostBreakdown(entry_charges=entry_charges, exit_charges=exit_charges, total_charges=round(entry_charges + exit_charges, 2))
