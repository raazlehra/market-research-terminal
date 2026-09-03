from __future__ import annotations

from .schemas import CalibrationBand, TradeRecord

BANDS = [(25, 50), (50, 60), (60, 70), (70, 80), (80, 90), (90, 96)]


def build_score_bands(trades: list[TradeRecord], min_observations: int = 30) -> list[CalibrationBand]:
    bands: list[CalibrationBand] = []
    for low, high in BANDS:
        group = [trade for trade in trades if low <= trade.score < high]
        wins = len([trade for trade in group if trade.net_pnl > 0])
        losses = len([trade for trade in group if trade.net_pnl < 0])
        breakeven = len([trade for trade in group if trade.net_pnl == 0])
        gross_returns = [trade.gross_return_pct for trade in group if trade.gross_return_pct is not None]
        net_returns = [trade.net_return_pct for trade in group if trade.net_return_pct is not None]
        r_values = [trade.r_multiple for trade in group if trade.r_multiple is not None]
        net_profit = sum(trade.net_pnl for trade in group if trade.net_pnl > 0)
        net_loss = sum(abs(trade.net_pnl) for trade in group if trade.net_pnl < 0)
        observations = len(group)
        label = f"{low}-{high - 1}"
        bands.append(CalibrationBand(
            band=label,
            low=low,
            high=high - 1,
            observations=observations,
            wins=wins,
            losses=losses,
            breakeven=breakeven,
            win_rate=round(wins / observations, 4) if observations else None,
            avg_gross_return_pct=_avg(gross_returns),
            avg_net_return_pct=_avg(net_returns),
            avg_r=_avg(r_values),
            expectancy_net=round(sum(trade.net_pnl for trade in group) / observations, 4) if observations else None,
            profit_factor=round(net_profit / net_loss, 4) if net_loss > 0 else None,
            warning="insufficient sample; empirical band is not calibrated" if observations < min_observations else None,
        ))
    return bands


def _avg(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 4) if values else None
