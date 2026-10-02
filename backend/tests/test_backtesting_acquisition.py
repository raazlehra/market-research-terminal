from __future__ import annotations

import asyncio
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from dataclasses import replace
from datetime import date, datetime, timedelta
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

import httpx

from backend.backtesting import cli
from backend.backtesting.acquisition import (
    AcquisitionService,
    DateRange,
    FetchRequest,
    FyersEquityHistoryProvider,
    InvalidHistoryRequestError,
    ProviderLimits,
    build_request_plan,
    normalize_history_response,
    parse_date,
    validate_date_range,
    validate_equity_symbol,
    validate_resolution,
)
from backend.backtesting.cache import EXPECTED_CANDLES_PER_SESSION, HistoricalCandleRepository
from backend.backtesting.data_adapters import load_csv
from backend.backtesting.replay import run_backtest_from_csv
from backend.backtesting.schemas import BacktestConfig, ExecutionPolicy, NormalizedCandle

IST = ZoneInfo("Asia/Kolkata")
SYMBOL = "NSE:MOCK-EQ"


class AcquisitionValidationTests(unittest.TestCase):
    def test_dry_run_makes_zero_network_calls_and_requires_execute_flag(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            provider = MockProvider()
            service = AcquisitionService(provider, HistoricalCandleRepository(Path(tmp) / "cache.sqlite3"))

            result = asyncio.run(service.fetch_equity([SYMBOL], "5", date(2026, 9, 1), date(2026, 9, 2)))

            self.assertFalse(result.executed)
            self.assertEqual(result.network_requests, 0)
            self.assertEqual(provider.calls, [])
            self.assertEqual(len(result.plan.requests), 1)

    def test_symbol_resolution_and_date_range_validation(self) -> None:
        self.assertEqual(validate_equity_symbol("nse:mock-eq"), SYMBOL)
        self.assertEqual(validate_resolution("5"), "5")
        self.assertEqual(parse_date("2026-09-01"), date(2026, 9, 1))
        validate_date_range(date(2026, 9, 1), date(2026, 9, 1))

        for bad_symbol in ("NSE:NIFTY50-INDEX", "NSE:NIFTY2670022000CE", "https://example.test", "BSE:MOCK-EQ"):
            with self.subTest(symbol=bad_symbol):
                with self.assertRaises(InvalidHistoryRequestError):
                    validate_equity_symbol(bad_symbol)
        with self.assertRaises(InvalidHistoryRequestError):
            validate_resolution("D")
        with self.assertRaises(InvalidHistoryRequestError):
            validate_date_range(date(2026, 9, 2), date(2026, 9, 1))
        with self.assertRaises(InvalidHistoryRequestError):
            build_request_plan([], "5", date(2026, 9, 1), date(2026, 9, 1))
        for limits in (
            ProviderLimits(max_days_per_request=0),
            ProviderLimits(max_retries=-1),
            ProviderLimits(request_pacing_seconds=-1),
            ProviderLimits(initial_backoff_seconds=float("nan")),
        ):
            with self.subTest(limits=limits):
                with self.assertRaises(InvalidHistoryRequestError):
                    build_request_plan([SYMBOL], "5", date(2026, 9, 1), date(2026, 9, 1), limits)

    def test_request_chunking_is_deterministic(self) -> None:
        plan = build_request_plan([SYMBOL], "15", date(2026, 1, 1), date(2026, 1, 5), ProviderLimits(max_days_per_request=2))
        repeat = build_request_plan([SYMBOL], "15", date(2026, 1, 1), date(2026, 1, 5), ProviderLimits(max_days_per_request=2))

        self.assertEqual([(item.start, item.end, item.request_id) for item in plan.requests], [(item.start, item.end, item.request_id) for item in repeat.requests])
        self.assertEqual([(item.start, item.end) for item in plan.requests], [(date(2026, 1, 1), date(2026, 1, 2)), (date(2026, 1, 3), date(2026, 1, 4)), (date(2026, 1, 5), date(2026, 1, 5))])

    def test_fyers_provider_validates_without_mutation_dependency(self) -> None:
        provider = FyersEquityHistoryProvider(MockProvider())
        response = asyncio.run(provider.history(SYMBOL, "5", _epoch(2026, 9, 1, 9, 15), _epoch(2026, 9, 1, 9, 20)))

        self.assertEqual(response["s"], "ok")
        with self.assertRaises(InvalidHistoryRequestError):
            asyncio.run(provider.history("NSE:NIFTY2670022000CE", "5", 1, 2))


class AcquisitionCacheTests(unittest.TestCase):
    def test_successful_multi_chunk_and_multiple_symbol_acquisition(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            provider = MockProvider()
            repo = HistoricalCandleRepository(Path(tmp) / "cache.sqlite3")
            service = AcquisitionService(provider, repo, ProviderLimits(max_days_per_request=1))

            result = asyncio.run(service.fetch_equity([SYMBOL, "NSE:ALT-EQ"], "5", date(2026, 9, 1), date(2026, 9, 2), execute_read_only=True))

            self.assertTrue(result.executed)
            self.assertEqual(result.network_requests, 4)
            self.assertEqual(len(provider.calls), 4)
            self.assertEqual(repo.status().candle_count, 4 * EXPECTED_CANDLES_PER_SESSION["5"])
            self.assertEqual(set(repo.status().symbols), {SYMBOL, "NSE:ALT-EQ"})

    def test_overlapping_cache_deduplicates_and_incremental_fetches_missing_days(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            provider = MockProvider()
            repo = HistoricalCandleRepository(Path(tmp) / "cache.sqlite3")
            service = AcquisitionService(provider, repo, ProviderLimits(max_days_per_request=1))

            first = asyncio.run(service.fetch_equity([SYMBOL], "5", date(2026, 9, 1), date(2026, 9, 1), execute_read_only=True))
            second_plan = service.plan_fetch([SYMBOL], "5", date(2026, 9, 1), date(2026, 9, 2))
            second = asyncio.run(service.fetch_equity([SYMBOL], "5", date(2026, 9, 1), date(2026, 9, 2), execute_read_only=True))

            self.assertEqual(first.symbols[0].inserted, EXPECTED_CANDLES_PER_SESSION["5"])
            self.assertEqual([(item.start, item.end) for item in second_plan.requests], [(date(2026, 9, 2), date(2026, 9, 2))])
            self.assertEqual(second.network_requests, 1)
            self.assertEqual(repo.status().candle_count, 2 * EXPECTED_CANDLES_PER_SESSION["5"])

    def test_incomplete_weekday_remains_missing_and_weekends_are_not_requested(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = HistoricalCandleRepository(Path(tmp) / "cache.sqlite3")
            friday = date(2026, 9, 4)
            monday = date(2026, 9, 7)
            repo.upsert_candles("fyers", [_candle(_dt(2026, 9, 4, 9, 15), close=100)], "partial")

            partial = repo.missing_date_ranges("fyers", SYMBOL, "5", friday, monday)
            repo.upsert_candles("fyers", _session_candles(friday, "5"), "complete")
            complete = repo.missing_date_ranges("fyers", SYMBOL, "5", friday, monday)

            self.assertEqual(partial, [DateRange(friday, friday), DateRange(monday, monday)])
            self.assertEqual(complete, [DateRange(monday, monday)])

    def test_empty_success_is_safe_and_remains_eligible_for_refetch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            provider = MockProvider(responses=[{"s": "ok", "candles": []}])
            repo = HistoricalCandleRepository(Path(tmp) / "cache.sqlite3")
            service = AcquisitionService(provider, repo)

            result = asyncio.run(service.fetch_equity([SYMBOL], "5", date(2026, 9, 1), date(2026, 9, 1), execute_read_only=True))
            repeat_plan = service.plan_fetch([SYMBOL], "5", date(2026, 9, 1), date(2026, 9, 1))

            self.assertEqual(result.symbols[0].fetched_candles, 0)
            self.assertEqual(result.symbols[0].failed, 0)
            self.assertEqual(repo.status().candle_count, 0)
            self.assertEqual(len(repeat_plan.requests), 1)

    def test_conflicting_candle_detection_and_deterministic_upsert_policy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = HistoricalCandleRepository(Path(tmp) / "cache.sqlite3")
            first = [_candle(_dt(2026, 9, 1, 9, 15), close=100)]
            conflict = [replace(first[0], close=101, high=101.5)]

            first_write = repo.upsert_candles("fyers", first, "request-a")
            second_write = repo.upsert_candles("fyers", conflict, "request-b")
            stored = repo.get_candles("fyers", [SYMBOL], "5")

            self.assertEqual(first_write.inserted, 1)
            self.assertEqual(second_write.conflicts, 1)
            self.assertEqual(second_write.updated, 1)
            self.assertEqual(stored[0].close, 101)

    def test_transaction_rollback_and_interruption_preserve_existing_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = HistoricalCandleRepository(Path(tmp) / "cache.sqlite3")
            repo.upsert_candles("fyers", [_candle(_dt(2026, 9, 1, 9, 15), close=100)], "seed")
            malformed = NormalizedCandle(symbol=SYMBOL, resolution="5", timestamp=_dt(2026, 9, 1, 9, 20), open=100, high=99, low=98, close=100, volume=1)

            with self.assertRaises(Exception):
                repo.upsert_candles("fyers", [malformed], "bad")

            self.assertEqual(repo.status().candle_count, 1)

    def test_malformed_and_non_finite_provider_rows_are_rejected(self) -> None:
        request = _request()
        bad_rows = [
            {"s": "ok", "candles": [["nan", 1, 2, 1, 1, 1]]},
            {"s": "ok", "candles": [[_epoch(2026, 9, 1, 9, 15), 1, 0.5, 1, 1, 1]]},
            {"s": "ok", "candles": [[_epoch(2026, 9, 1, 9, 15), 1, 2, 1, 1, -1]]},
            {"s": "ok", "candles": [["short"]]},
        ]

        for payload in bad_rows:
            with self.subTest(payload=payload):
                with self.assertRaises(InvalidHistoryRequestError):
                    normalize_history_response(request, payload)

    def test_provider_rows_are_sorted_deduplicated_and_range_session_bounded(self) -> None:
        request = _request()
        first = [_epoch(2026, 9, 1, 9, 15), 100, 101, 99, 100.5, 1000]
        second = [_epoch(2026, 9, 1, 9, 20), 100.5, 102, 100, 101.5, 1200]

        normalized = normalize_history_response(request, {"s": "ok", "candles": [second, first, first]})

        self.assertEqual([item.epoch for item in normalized], [int(first[0]), int(second[0])])
        bad_payloads = [
            {"s": "ok", "candles": [[_epoch(2026, 9, 2, 9, 15), 100, 101, 99, 100.5, 1000]]},
            {"s": "ok", "candles": [[_epoch(2026, 9, 1, 8, 0), 100, 101, 99, 100.5, 1000]]},
            {"s": "ok", "candles": [first, [first[0], 100, 102, 99, 101.5, 1000]]},
        ]
        for payload in bad_payloads:
            with self.subTest(payload=payload):
                with self.assertRaises(InvalidHistoryRequestError):
                    normalize_history_response(request, payload)

    def test_utc_storage_ist_interpretation_export_and_fingerprint_stability(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = HistoricalCandleRepository(Path(tmp) / "cache.sqlite3")
            candles = [_candle(_dt(2026, 9, 1, 9, 15), close=100), _candle(_dt(2026, 9, 1, 9, 20), close=101)]
            repo.upsert_candles("fyers", candles, "request")
            first_fingerprint = repo.dataset_fingerprint([SYMBOL], "5")
            second_fingerprint = repo.dataset_fingerprint([SYMBOL], "5")
            export_path = Path(tmp) / "export.csv"

            repo.export_csv(export_path, [SYMBOL], "5")
            exported, report = load_csv(export_path)

            self.assertEqual(first_fingerprint, second_fingerprint)
            self.assertEqual(report.rejected, 0)
            self.assertEqual([item.timestamp for item in exported], [item.timestamp for item in candles])
            self.assertIn("+05:30", export_path.read_text(encoding="utf-8"))

    def test_exported_csv_is_accepted_by_slice1_backtester(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = HistoricalCandleRepository(Path(tmp) / "cache.sqlite3")
            fixture_candles, _ = load_csv("backend/tests/fixtures/backtesting/golden_breakout_equity_ohlcv.csv")
            repo.upsert_candles("fyers", fixture_candles, "golden")
            export_path = Path(tmp) / "golden-export.csv"
            repo.export_csv(export_path, ["NSE:GOLDEN-EQ"], "5")

            result = run_backtest_from_csv(
                str(export_path),
                BacktestConfig(
                    strategy="BREAKOUT",
                    symbols=["NSE:GOLDEN-EQ"],
                    resolution="5",
                    start=_dt(2026, 9, 2, 9, 15),
                    end=_dt(2026, 9, 2, 9, 45),
                    score_threshold=25,
                    execution=ExecutionPolicy(fixed_quantity=10, slippage_bps=0, max_holding_bars=3),
                ),
            )

            self.assertEqual(result.metrics.trade_count, 1)


class AcquisitionRetryAndCliTests(unittest.TestCase):
    def test_transient_payloads_and_network_errors_are_retried_but_auth_is_not(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            transient = MockProvider(responses=[{"s": "error", "code": 429, "message": "slow down"}, {"s": "error", "code": 500, "message": "server"}, MockProvider.ok_response(SYMBOL)])
            service = AcquisitionService(transient, HistoricalCandleRepository(Path(tmp) / "retry.sqlite3"), ProviderLimits(max_retries=3, initial_backoff_seconds=0, max_backoff_seconds=0))
            result = asyncio.run(service.fetch_equity([SYMBOL], "5", date(2026, 9, 1), date(2026, 9, 1), execute_read_only=True))

            self.assertEqual(result.network_requests, 3)
            self.assertEqual(result.symbols[0].failed, 0)

        with tempfile.TemporaryDirectory() as tmp:
            request = httpx.Request("GET", "https://example.test/history")
            network = MockProvider(responses=[httpx.ConnectError("temporary timeout", request=request), MockProvider.ok_response(SYMBOL)])
            service = AcquisitionService(network, HistoricalCandleRepository(Path(tmp) / "network.sqlite3"), ProviderLimits(max_retries=2, initial_backoff_seconds=0, max_backoff_seconds=0))
            result = asyncio.run(service.fetch_equity([SYMBOL], "5", date(2026, 9, 1), date(2026, 9, 1), execute_read_only=True))

            self.assertEqual(result.network_requests, 2)
            self.assertEqual(result.symbols[0].failed, 0)

        with tempfile.TemporaryDirectory() as tmp:
            auth = MockProvider(responses=[{"s": "error", "code": 401, "message": "token expired"}])
            service = AcquisitionService(auth, HistoricalCandleRepository(Path(tmp) / "auth.sqlite3"), ProviderLimits(max_retries=3, initial_backoff_seconds=0, max_backoff_seconds=0))
            result = asyncio.run(service.fetch_equity([SYMBOL], "5", date(2026, 9, 1), date(2026, 9, 1), execute_read_only=True))

            self.assertEqual(result.network_requests, 1)
            self.assertEqual(result.symbols[0].failed, 1)
            self.assertNotIn("token", " ".join(result.symbols[0].errors).lower())

    def test_cli_help_plan_cache_export_and_legacy_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            cache_path = str(Path(tmp) / "cache.sqlite3")
            export_path = str(Path(tmp) / "export.csv")
            help_code, help_output = _cli(["--help"])
            legacy_code, legacy_output = _cli(["--csv", "backend/tests/fixtures/backtesting/golden_breakout_equity_ohlcv.csv", "--strategy", "BREAKOUT", "--symbols", "NSE:GOLDEN-EQ", "--resolution", "5", "--start", "2026-09-02T09:15:00+05:30", "--end", "2026-09-02T09:45:00+05:30", "--score-threshold", "25", "--fixed-quantity", "10", "--slippage-bps", "0", "--max-holding-bars", "3"])
            plan_code, plan_output = _cli(["plan-fetch", "--cache-db", cache_path, "--symbols", SYMBOL, "--resolution", "5", "--start-date", "2026-09-01", "--end-date", "2026-09-01"])
            dry_code, dry_output = _cli(["fetch-equity", "--cache-db", cache_path, "--symbols", SYMBOL, "--resolution", "5", "--start-date", "2026-09-01", "--end-date", "2026-09-01"])
            status_code, status_output = _cli(["cache-status", "--cache-db", cache_path])

            repo = HistoricalCandleRepository(cache_path)
            repo.upsert_candles("fyers", [_candle(_dt(2026, 9, 1, 9, 15), close=100)], "seed")
            export_code, export_output = _cli(["export-csv", "--cache-db", cache_path, "--symbols", SYMBOL, "--resolution", "5", "--output", export_path])

            self.assertEqual(help_code, 0)
            self.assertIn("plan-fetch", help_output)
            self.assertEqual(legacy_code, 0)
            self.assertIn("trades=1", legacy_output)
            self.assertEqual(plan_code, 0)
            self.assertIn("READ-ONLY DRY RUN", plan_output)
            self.assertEqual(dry_code, 0)
            self.assertIn("DRY RUN", dry_output)
            self.assertEqual(status_code, 0)
            self.assertIn("Cache status", status_output)
            self.assertEqual(export_code, 0)
            self.assertTrue(Path(export_path).exists())
            self.assertIn("Export complete", export_output)

    def test_cli_invalid_limits_and_corrupt_cache_fail_with_code_two(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            corrupt = Path(tmp) / "corrupt.sqlite3"
            corrupt.write_bytes(b"not a sqlite database")
            corrupt_code, corrupt_output = _cli(["cache-status", "--cache-db", str(corrupt)])
            limits_code, limits_output = _cli(["plan-fetch", "--cache-db", str(Path(tmp) / "cache.sqlite3"), "--symbols", SYMBOL, "--resolution", "5", "--start-date", "2026-09-01", "--end-date", "2026-09-01", "--max-retries", "-1"])

            self.assertEqual(corrupt_code, 2)
            self.assertIn("Backtesting command failed", corrupt_output)
            self.assertEqual(limits_code, 2)
            self.assertIn("max_retries", limits_output)

    def test_cli_execute_read_only_fails_closed_without_auth(self) -> None:
        with patch("backend.backtesting.cli._app_provider", side_effect=RuntimeError("FYERS authentication is missing.")):
            code, output = _cli(["fetch-equity", "--cache-db", ":memory:", "--symbols", SYMBOL, "--resolution", "5", "--start-date", "2026-09-01", "--end-date", "2026-09-01", "--execute-read-only"])

        self.assertEqual(code, 2)
        self.assertIn("Read-only acquisition refused", output)
        self.assertNotIn("Authorization", output)

    def test_no_credentials_in_cache_logs_exceptions_or_cli_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            provider = MockProvider(responses=[{"s": "error", "code": 401, "message": "Bearer token secret leaked"}])
            service = AcquisitionService(provider, HistoricalCandleRepository(Path(tmp) / "cache.sqlite3"), ProviderLimits(max_retries=0))
            result = asyncio.run(service.fetch_equity([SYMBOL], "5", date(2026, 9, 1), date(2026, 9, 1), execute_read_only=True))
            db_bytes = (Path(tmp) / "cache.sqlite3").read_bytes()

            self.assertIn("redacted", result.symbols[0].errors[0])
            self.assertNotIn(b"Bearer", db_bytes)
            self.assertNotIn(b"secret", db_bytes.lower())

    def test_no_fyers_mutation_references_in_acquisition_package(self) -> None:
        forbidden = ("place_order", "modify_order", "cancel_order", "exit_position", "squareoff_all")
        source = "\n".join(path.read_text(encoding="utf-8") for path in Path("backend/backtesting").glob("*.py"))

        for token in forbidden:
            self.assertNotIn(token, source)


class MockProvider:
    def __init__(self, responses: list[dict[str, object] | Exception] | None = None) -> None:
        self.calls: list[tuple[str, str, int, int]] = []
        self.responses = list(responses or [])

    async def history(self, symbol: str, resolution: str, frm: int, to: int) -> dict[str, object]:
        self.calls.append((symbol, resolution, frm, to))
        if self.responses:
            response = self.responses.pop(0)
            if isinstance(response, Exception):
                raise response
            return response
        return self.ok_response(symbol, frm, resolution)

    @staticmethod
    def ok_response(symbol: str, start_epoch: int | None = None, resolution: str = "5") -> dict[str, object]:
        del symbol
        start = datetime.fromtimestamp(start_epoch, IST) if start_epoch is not None else _dt(2026, 9, 1, 0, 0)
        candles = _session_candles(start.date(), resolution)
        return {
            "s": "ok",
            "candles": [item.scanner_row() for item in candles],
        }


def _cli(args: list[str]) -> tuple[int, str]:
    stream = io.StringIO()
    with redirect_stdout(stream), patch("sys.stderr", stream):
        try:
            code = cli.main(args)
        except SystemExit as exc:
            code = int(exc.code or 0)
    return code, stream.getvalue()


def _request() -> FetchRequest:
    return FetchRequest(SYMBOL, "5", date(2026, 9, 1), date(2026, 9, 1), _epoch(2026, 9, 1, 0, 0), _epoch(2026, 9, 1, 23, 59), "request")


def _candle(timestamp: datetime, close: float) -> NormalizedCandle:
    return NormalizedCandle(SYMBOL, "5", timestamp, close, close + 0.5, close - 0.5, close, 1000)


def _session_candles(day: date, resolution: str) -> list[NormalizedCandle]:
    step = int(resolution)
    count = EXPECTED_CANDLES_PER_SESSION[resolution]
    start = datetime(day.year, day.month, day.day, 9, 15, tzinfo=IST)
    candles = []
    for index in range(count):
        timestamp = start + timedelta(minutes=index * step)
        close = 100 + index / 10
        candles.append(NormalizedCandle(SYMBOL, resolution, timestamp, close, close + 0.5, close - 0.5, close, 1000))
    return candles


def _dt(year: int, month: int, day: int, hour: int, minute: int) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=IST)


def _epoch(year: int, month: int, day: int, hour: int, minute: int) -> int:
    return int(_dt(year, month, day, hour, minute).timestamp())


if __name__ == "__main__":
    unittest.main()
