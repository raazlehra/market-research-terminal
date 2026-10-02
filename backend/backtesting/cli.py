from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
import sqlite3
import sys

from .acquisition import AcquisitionError, AcquisitionService, FyersEquityHistoryProvider, ProviderLimits, parse_date
from .cache import DEFAULT_CACHE_PATH, HistoricalCandleRepository
from .data_adapters import parse_timestamp
from .replay import run_backtest_from_csv
from .schemas import BacktestConfig, ExecutionPolicy
from .storage import write_result_json

COMMANDS = {"run", "plan-fetch", "fetch-equity", "cache-status", "export-csv"}


def main(argv: list[str] | None = None) -> int:
    args_list = list(sys.argv[1:] if argv is None else argv)
    if args_list in (["-h"], ["--help"]):
        parser = _command_parser()
        parser.print_help()
        return 0
    if not args_list or args_list[0] not in COMMANDS:
        return _run_backtest(_legacy_parser().parse_args(args_list))

    parser = _command_parser()
    args = parser.parse_args(args_list)

    try:
        if args.command == "run":
            return _run_backtest(args)
        if args.command == "plan-fetch":
            return _plan_fetch(args)
        if args.command == "fetch-equity":
            return asyncio.run(_fetch_equity(args))
        if args.command == "cache-status":
            return _cache_status(args)
        if args.command == "export-csv":
            return _export_csv(args)
    except (AcquisitionError, OSError, sqlite3.DatabaseError) as exc:
        print(f"Backtesting command failed: {exc}", file=sys.stderr)
        return 2
    return 2


def _command_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Offline equity backtesting and read-only history-cache tools.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    _add_run_parser(subparsers)
    _add_plan_parser(subparsers, "plan-fetch")
    _add_plan_parser(subparsers, "fetch-equity")
    _add_cache_status_parser(subparsers)
    _add_export_parser(subparsers)
    return parser


def _legacy_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run an offline deterministic equity scanner backtest.")
    _add_run_arguments(parser)
    return parser


def _add_run_parser(subparsers) -> None:
    parser = subparsers.add_parser("run", help="Run an offline deterministic backtest from CSV.")
    _add_run_arguments(parser)


def _add_run_arguments(parser: argparse.ArgumentParser) -> None:
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


def _run_backtest(args: argparse.Namespace) -> int:
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


def _add_plan_parser(subparsers, name: str) -> None:
    parser = subparsers.add_parser(name, help="Plan or execute read-only NSE equity history acquisition.")
    parser.add_argument("--symbol", action="append", dest="individual_symbols", help="NSE equity symbol. May be repeated.")
    parser.add_argument("--symbols", help="Comma-separated NSE equity symbols.")
    parser.add_argument("--resolution", required=True, choices=["5", "15", "60"])
    parser.add_argument("--start-date", required=True, help="Start date in YYYY-MM-DD.")
    parser.add_argument("--end-date", required=True, help="End date in YYYY-MM-DD.")
    parser.add_argument("--cache-db", default=str(DEFAULT_CACHE_PATH), help="Local SQLite cache path.")
    parser.add_argument("--max-days-per-request", type=int, default=100)
    parser.add_argument("--request-pacing-seconds", type=float, default=0.0)
    parser.add_argument("--max-retries", type=int, default=2)
    parser.add_argument("--initial-backoff-seconds", type=float, default=0.1)
    parser.add_argument("--max-backoff-seconds", type=float, default=1.0)
    if name == "fetch-equity":
        parser.add_argument("--execute-read-only", action="store_true", help="Required to make read-only history network requests.")


def _plan_fetch(args: argparse.Namespace) -> int:
    service = _service(args, provider=_NoNetworkProvider())
    plan = service.plan_fetch(_symbols(args.symbols, args.individual_symbols), args.resolution, parse_date(args.start_date), parse_date(args.end_date), dry_run=True)
    _print_plan(plan)
    return 0


async def _fetch_equity(args: argparse.Namespace) -> int:
    if not args.execute_read_only:
        service = _service(args, provider=_NoNetworkProvider())
        plan = service.plan_fetch(_symbols(args.symbols, args.individual_symbols), args.resolution, parse_date(args.start_date), parse_date(args.end_date), dry_run=True)
        _print_plan(plan)
        print("DRY RUN: add --execute-read-only to perform read-only FYERS history requests.")
        return 0

    try:
        provider = _app_provider()
    except RuntimeError as exc:
        print(f"Read-only acquisition refused: {exc}", file=sys.stderr)
        return 2
    service = _service(args, provider=provider)
    print("Executing read-only historical market-data acquisition. No broker mutation endpoints are used.")
    result = await service.fetch_equity(_symbols(args.symbols, args.individual_symbols), args.resolution, parse_date(args.start_date), parse_date(args.end_date), execute_read_only=True)
    print(
        "Fetch complete: "
        f"executed={str(result.executed).lower()} "
        f"network_requests={result.network_requests} "
        f"symbols={len(result.symbols)} "
        f"failures={sum(item.failed for item in result.symbols)}"
    )
    for item in result.symbols:
        print(
            f"{item.symbol}: requested={item.requested} fetched={item.fetched_candles} "
            f"inserted={item.inserted} updated={item.updated} unchanged={item.unchanged} conflicts={item.conflicts} failed={item.failed}"
        )
    return 2 if any(item.failed for item in result.symbols) else 0


def _add_cache_status_parser(subparsers) -> None:
    parser = subparsers.add_parser("cache-status", help="Print local history cache status.")
    parser.add_argument("--cache-db", default=str(DEFAULT_CACHE_PATH), help="Local SQLite cache path.")


def _cache_status(args: argparse.Namespace) -> int:
    status = HistoricalCandleRepository(args.cache_db).status()
    print(
        "Cache status: "
        f"path={status.path} candles={status.candle_count} "
        f"symbols={','.join(status.symbols) if status.symbols else '-'} "
        f"resolutions={','.join(status.resolutions) if status.resolutions else '-'} "
        f"earliest={status.earliest or '-'} latest={status.latest or '-'}"
    )
    return 0


def _add_export_parser(subparsers) -> None:
    parser = subparsers.add_parser("export-csv", help="Export normalized cached candles to backtesting CSV.")
    parser.add_argument("--cache-db", default=str(DEFAULT_CACHE_PATH), help="Local SQLite cache path.")
    parser.add_argument("--symbol", action="append", dest="individual_symbols", help="NSE equity symbol. May be repeated.")
    parser.add_argument("--symbols", help="Comma-separated NSE equity symbols.")
    parser.add_argument("--resolution", required=True, choices=["5", "15", "60"])
    parser.add_argument("--start-date")
    parser.add_argument("--end-date")
    parser.add_argument("--output", required=True, help="Output CSV path.")


def _export_csv(args: argparse.Namespace) -> int:
    symbols = _symbols(args.symbols, args.individual_symbols)
    start = parse_date(args.start_date) if args.start_date else None
    end = parse_date(args.end_date) if args.end_date else None
    path = HistoricalCandleRepository(args.cache_db).export_csv(args.output, symbols, args.resolution, start, end)
    print(f"Export complete: path={path}")
    return 0


def _service(args: argparse.Namespace, provider) -> AcquisitionService:
    limits = ProviderLimits(
        max_days_per_request=args.max_days_per_request,
        request_pacing_seconds=args.request_pacing_seconds,
        max_retries=args.max_retries,
        initial_backoff_seconds=args.initial_backoff_seconds,
        max_backoff_seconds=args.max_backoff_seconds,
    )
    return AcquisitionService(provider, HistoricalCandleRepository(args.cache_db), limits)


def _app_provider() -> FyersEquityHistoryProvider:
    from backend.state import fyers

    if not getattr(fyers, "ready", False) or not getattr(fyers, "app_id", None) or not getattr(fyers, "token", None):
        raise RuntimeError("FYERS authentication is missing. Log in through the app first; tokens are not accepted as CLI arguments.")
    return FyersEquityHistoryProvider(fyers)


def _print_plan(plan) -> None:
    print(
        "READ-ONLY DRY RUN: "
        f"provider={plan.provider} symbols={','.join(plan.symbols)} resolution={plan.resolution} "
        f"start={plan.start.isoformat()} end={plan.end.isoformat()} requests={len(plan.requests)}"
    )
    for request in plan.requests:
        print(f"request {request.request_id}: {request.symbol} {request.resolution} {request.start.isoformat()}..{request.end.isoformat()}")
    for warning in plan.warnings:
        print(f"warning: {warning}")


class _NoNetworkProvider:
    async def history(self, symbol: str, resolution: str, start_epoch: int, end_epoch: int):
        raise RuntimeError("dry-run provider must not be called")


def _symbols(comma_separated: str | None, repeated: list[str] | None) -> list[str]:
    values: list[str] = []
    if comma_separated:
        values.extend(item.strip() for item in comma_separated.split(","))
    if repeated:
        values.extend(repeated)
    normalized = [value.upper() for value in values if value.strip()]
    if not normalized:
        raise SystemExit("At least one --symbol or --symbols value is required.")
    return list(dict.fromkeys(normalized))


def _format_optional_pct(value: float | None) -> str:
    if value is None:
        return "unavailable"
    return f"{value:.4f}%"


if __name__ == "__main__":
    raise SystemExit(main())
