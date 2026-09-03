from __future__ import annotations

from .schemas import EquityCurvePoint, MetricsSummary, TradeRecord


def safe_pct(numerator: float, denominator: float) -> float | None:
    return round((numerator / denominator) * 100, 4) if denominator > 0 else None


def build_equity_curve(trades: list[TradeRecord], starting_equity: float = 0.0) -> list[EquityCurvePoint]:
    equity = starting_equity
    peak = starting_equity
    points: list[EquityCurvePoint] = []
    for trade in sorted(trades, key=lambda item: item.exit_time):
        equity = round(equity + trade.net_pnl, 2)
        peak = max(peak, equity)
        points.append(EquityCurvePoint(timestamp=trade.exit_time, equity=equity, drawdown=round(equity - peak, 2)))
    return points


def summarize_trades(trades: list[TradeRecord]) -> tuple[MetricsSummary, list[EquityCurvePoint]]:
    trade_count = len(trades)
    gross_pnl = round(sum(trade.gross_pnl for trade in trades), 2)
    total_charges = round(sum(trade.total_charges for trade in trades), 2)
    net_pnl = round(sum(trade.net_pnl for trade in trades), 2)
    entry_notional = round(sum(trade.entry_notional for trade in trades), 2)
    wins = [trade for trade in trades if trade.net_pnl > 0]
    losses = [trade for trade in trades if trade.net_pnl < 0]
    breakeven = len([trade for trade in trades if trade.net_pnl == 0])
    r_values = [trade.r_multiple for trade in trades if trade.r_multiple is not None]
    gross_profit = round(sum(trade.gross_pnl for trade in trades if trade.gross_pnl > 0), 2)
    gross_loss = round(sum(abs(trade.gross_pnl) for trade in trades if trade.gross_pnl < 0), 2)
    net_profit = round(sum(trade.net_pnl for trade in trades if trade.net_pnl > 0), 2)
    net_loss = round(sum(abs(trade.net_pnl) for trade in trades if trade.net_pnl < 0), 2)
    curve = build_equity_curve(trades)
    summary = MetricsSummary(
        trade_count=trade_count,
        gross_pnl=gross_pnl,
        total_charges=total_charges,
        net_pnl=net_pnl,
        entry_notional=entry_notional,
        gross_return_pct=safe_pct(gross_pnl, entry_notional),
        net_return_pct=safe_pct(net_pnl, entry_notional),
        win_rate=round(len(wins) / trade_count, 4) if trade_count else None,
        loss_rate=round(len(losses) / trade_count, 4) if trade_count else None,
        breakeven_count=breakeven,
        expectancy_net=round(net_pnl / trade_count, 4) if trade_count else None,
        expectancy_r=round(sum(r_values) / len(r_values), 4) if r_values else None,
        gross_profit=gross_profit,
        gross_loss=gross_loss,
        profit_factor=round(net_profit / net_loss, 4) if net_loss > 0 else None,
        profit_factor_basis="net_pnl",
        max_drawdown=round(min((point.drawdown for point in curve), default=0.0), 2),
        longest_losing_streak=longest_losing_streak(trades),
    )
    return summary, curve


def longest_losing_streak(trades: list[TradeRecord]) -> int:
    longest = 0
    current = 0
    for trade in sorted(trades, key=lambda item: item.exit_time):
        if trade.net_pnl < 0:
            current += 1
            longest = max(longest, current)
        elif trade.net_pnl > 0:
            current = 0
    return longest
