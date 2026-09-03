from __future__ import annotations

import argparse
from pathlib import Path
import sys

from .data_adapters import parse_timestamp
from .replay import run_backtest_from_csv
from .schemas import BacktestConfig, ExecutionPolicy
from .storage import write_result_json


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run an offline deterministic equity scanner backtest.")
    parser.add_argument("--csv", required=True, help="Path to normalized OHLCV CSV input.")
    parser.add_argument("--strategy", required=True, choices=["VOLUME_SPIKE", "BREAKOUT_VOLUME", "BREAKOUT", "EMA_CROSS", "VWAP_BREAKOUT"])
    parser.add_argument("--symbol", action="append", dest="individual_symbols", help="Symbol to include. May be repeated.")
    parser.add_argument("--symbols", help="Comma-separated symbols to include.")
    parser.add_argument("--resolution", required=True, help="Scanner resolution such as 1, 5, 15, 60, or D.")
    parser.add_argument("--start", help="Replay start timestamp, epoch seconds or ISO-8601.")
    parser.add_argument("--end", help="Replay end timestamp, epoch seconds or ISO-8601.")
    parser.add_argument("--score-threshold", type=float, default=50.0)
    parser.add_argument("--fixed-quantity", type=int, default=1)
    parser.add_argument("--slippage-bps", type=float, default=5.0)
    parser.add_argument("--max-holding-bars", type=int, default=20)
    parser.add_argument("--run-id")
    parser.add_argument("--seed", type=int)
    parser.add_argument("--output", help="Optional structured JSON result path.")
    args = parser.parse_args(argv)

    symbols = _symbols(args.symbols, args.individual_symbols)
    config = BacktestConfig(
        strategy=args.strategy,
        symbols=symbols,
        resolution=args.resolution.upper(),
        start=parse_timestamp(args.start) if args.start else None,
        end=parse_timestamp(args.end) if args.end else None,
        score_threshold=args.score_threshold,
        execution=ExecutionPolicy(
            fixed_quantity=args.fixed_quantity,
            slippage_bps=args.slippage_bps,
            max_holding_bars=args.max_holding_bars,
        ),
        run_id=args.run_id,
        seed=args.seed,
    )
    try:
        result = run_backtest_from_csv(args.csv, config)
    except Exception as exc:
        print(f"Backtest failed: {exc}", file=sys.stderr)
        return 2
    if args.output:
        write_result_json(result, Path(args.output))
    print(
        "Backtest complete: "
        f"run_id={result.metadata.run_id} "
        f"trades={result.metrics.trade_count} "
        f"gross_pnl={result.metrics.gross_pnl:.2f} "
        f"charges={result.metrics.total_charges:.2f} "
        f"net_pnl={result.metrics.net_pnl:.2f} "
        f"gross_return={_format_optional_pct(result.metrics.gross_return_pct)} "
        f"net_return={_format_optional_pct(result.metrics.net_return_pct)} "
        f"score_band_observations={sum(band.observations for band in result.calibration_bands)}"
    )
    if result.metadata.unsupported_data_reasons:
        print(f"Unsupported data reasons: {len(result.metadata.unsupported_data_reasons)}")
    if result.metadata.warnings:
        print(f"Warnings: {len(result.metadata.warnings)}")
    if result.metadata.unsupported_data_reasons:
        return 2
    return 0


def _symbols(comma_separated: str | None, repeated: list[str] | None) -> list[str]:
    values: list[str] = []
    if comma_separated:
        values.extend(item.strip() for item in comma_separated.split(","))
    if repeated:
        values.extend(repeated)
    normalized = [value.upper() for value in values if value.strip()]
    if not normalized:
        raise SystemExit("At least one --symbol or --symbols value is required.")
    return normalized


def _format_optional_pct(value: float | None) -> str:
    if value is None:
        return "unavailable"
    return f"{value:.4f}%"


if __name__ == "__main__":
    raise SystemExit(main())
