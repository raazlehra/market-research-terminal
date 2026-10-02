from __future__ import annotations

import asyncio
import math
import re
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Protocol

import httpx

from .data_adapters import IST, is_nse_session
from .schemas import NormalizedCandle

SUPPORTED_EQUITY_RESOLUTIONS = {"5", "15", "60"}
EQUITY_SYMBOL_PATTERN = re.compile(r"^NSE:[A-Z0-9&.\-]+-EQ$")
TRANSIENT_STATUS_CODES = {429, 500, 502, 503, 504}
AUTH_STATUS_CODES = {401, 403}
INVALID_STATUS_CODES = {400, 404, 422}


class HistoricalCandleProvider(Protocol):
    async def history(self, symbol: str, resolution: str, frm: int, to: int) -> dict[str, Any]:
        ...


@dataclass(frozen=True)
class ProviderLimits:
    max_days_per_request: int = 100
    request_pacing_seconds: float = 0.0
    max_retries: int = 2
    initial_backoff_seconds: float = 0.1
    max_backoff_seconds: float = 1.0
    verified_source: str | None = "FYERS market-data docs: minute history max range is documented as 100 days per request."


@dataclass(frozen=True)
class DateRange:
    start: date
    end: date


@dataclass(frozen=True)
class FetchRequest:
    symbol: str
    resolution: str
    start: date
    end: date
    start_epoch: int
    end_epoch: int
    request_id: str


@dataclass(frozen=True)
class AcquisitionPlan:
    provider: str
    symbols: list[str]
    resolution: str
    start: date
    end: date
    requests: list[FetchRequest]
    dry_run: bool
    read_only: bool = True
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class SymbolAcquisitionResult:
    symbol: str
    requested: int
    fetched_candles: int
    inserted: int
    updated: int
    unchanged: int
    conflicts: int
    failed: int
    errors: list[str]


@dataclass(frozen=True)
class AcquisitionResult:
    plan: AcquisitionPlan
    executed: bool
    network_requests: int
    symbols: list[SymbolAcquisitionResult]


class AcquisitionError(RuntimeError):
    pass


class AuthenticationRequiredError(AcquisitionError):
    pass


class InvalidHistoryRequestError(AcquisitionError):
    pass


class TransientHistoryError(AcquisitionError):
    pass


def validate_equity_symbol(symbol: str) -> str:
    normalized = str(symbol or "").strip().upper()
    if "://" in normalized or "/" in normalized or "\\" in normalized:
        raise InvalidHistoryRequestError("Only explicit NSE equity symbols are accepted; URLs and paths are rejected.")
    if not EQUITY_SYMBOL_PATTERN.fullmatch(normalized):
        raise InvalidHistoryRequestError("Only NSE equity symbols in NSE:...-EQ form are supported in this slice.")
    return normalized


def validate_resolution(resolution: str) -> str:
    normalized = str(resolution or "").strip().upper()
    if normalized not in SUPPORTED_EQUITY_RESOLUTIONS:
        raise InvalidHistoryRequestError("Only 5, 15 and 60 minute equity history resolutions are supported in this slice.")
    return normalized


def parse_date(value: str) -> date:
    try:
        return date.fromisoformat(str(value).strip())
    except ValueError as exc:
        raise InvalidHistoryRequestError("Dates must use YYYY-MM-DD format.") from exc


def validate_date_range(start: date, end: date) -> DateRange:
    if end < start:
        raise InvalidHistoryRequestError("End date must be on or after start date.")
    return DateRange(start=start, end=end)


def build_request_plan(
    symbols: list[str],
    resolution: str,
    start: date,
    end: date,
    limits: ProviderLimits | None = None,
    missing_ranges: dict[str, list[DateRange]] | None = None,
    dry_run: bool = True,
) -> AcquisitionPlan:
    limits = limits or ProviderLimits()
    validate_provider_limits(limits)
    normalized_symbols = list(dict.fromkeys(validate_equity_symbol(symbol) for symbol in symbols))
    if not normalized_symbols:
        raise InvalidHistoryRequestError("At least one NSE equity symbol is required.")
    normalized_resolution = validate_resolution(resolution)
    validated = validate_date_range(start, end)
    requests: list[FetchRequest] = []
    for symbol in normalized_symbols:
        ranges = missing_ranges.get(symbol, [validated]) if missing_ranges else [validated]
        for missing in ranges:
            requests.extend(_chunk_range(symbol, normalized_resolution, missing.start, missing.end, limits.max_days_per_request))
    return AcquisitionPlan(
        provider="fyers",
        symbols=normalized_symbols,
        resolution=normalized_resolution,
        start=validated.start,
        end=validated.end,
        requests=requests,
        dry_run=dry_run,
        warnings=[] if requests else ["No acquisition requests are required; the range is cached or has no trading weekdays."],
    )


def validate_provider_limits(limits: ProviderLimits) -> None:
    if limits.max_days_per_request <= 0:
        raise InvalidHistoryRequestError("max_days_per_request must be positive.")
    if limits.max_retries < 0:
        raise InvalidHistoryRequestError("max_retries cannot be negative.")
    for name, value in (
        ("request_pacing_seconds", limits.request_pacing_seconds),
        ("initial_backoff_seconds", limits.initial_backoff_seconds),
        ("max_backoff_seconds", limits.max_backoff_seconds),
    ):
        if not math.isfinite(value) or value < 0:
            raise InvalidHistoryRequestError(f"{name} must be a finite non-negative value.")


def _chunk_range(symbol: str, resolution: str, start: date, end: date, max_days: int) -> list[FetchRequest]:
    chunks: list[FetchRequest] = []
    cursor = start
    while cursor <= end:
        chunk_end = min(end, cursor + timedelta(days=max_days - 1))
        start_epoch = int(datetime.combine(cursor, time.min, tzinfo=IST).timestamp())
        end_epoch = int(datetime.combine(chunk_end, time(23, 59, 59), tzinfo=IST).timestamp())
        request_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"fyers-history:{symbol}:{resolution}:{cursor.isoformat()}:{chunk_end.isoformat()}"))
        chunks.append(FetchRequest(symbol=symbol, resolution=resolution, start=cursor, end=chunk_end, start_epoch=start_epoch, end_epoch=end_epoch, request_id=request_id))
        cursor = chunk_end + timedelta(days=1)
    return chunks


class FyersEquityHistoryProvider:
    def __init__(self, client: HistoricalCandleProvider) -> None:
        self._client = client

    async def history(self, symbol: str, resolution: str, frm: int, to: int) -> dict[str, Any]:
        validate_equity_symbol(symbol)
        validate_resolution(resolution)
        return await self._client.history(symbol, resolution, frm, to)


class AcquisitionService:
    def __init__(self, provider: HistoricalCandleProvider, repository, limits: ProviderLimits | None = None) -> None:
        self.provider = provider
        self.repository = repository
        self.limits = limits or ProviderLimits()

    def plan_fetch(self, symbols: list[str], resolution: str, start: date, end: date, dry_run: bool = True) -> AcquisitionPlan:
        normalized_symbols = list(dict.fromkeys(validate_equity_symbol(symbol) for symbol in symbols))
        if not normalized_symbols:
            raise InvalidHistoryRequestError("At least one NSE equity symbol is required.")
        normalized_resolution = validate_resolution(resolution)
        validated = validate_date_range(start, end)
        missing = {
            symbol: self.repository.missing_date_ranges("fyers", symbol, normalized_resolution, validated.start, validated.end)
            for symbol in normalized_symbols
        }
        return build_request_plan(normalized_symbols, normalized_resolution, validated.start, validated.end, self.limits, missing, dry_run=dry_run)

    async def fetch_equity(
        self,
        symbols: list[str],
        resolution: str,
        start: date,
        end: date,
        execute_read_only: bool = False,
    ) -> AcquisitionResult:
        plan = self.plan_fetch(symbols, resolution, start, end, dry_run=not execute_read_only)
        if not execute_read_only:
            return AcquisitionResult(plan=plan, executed=False, network_requests=0, symbols=[])
        results: dict[str, SymbolAcquisitionResult] = {
            symbol: SymbolAcquisitionResult(symbol=symbol, requested=0, fetched_candles=0, inserted=0, updated=0, unchanged=0, conflicts=0, failed=0, errors=[])
            for symbol in plan.symbols
        }
        network_requests = 0
        for request in plan.requests:
            current = results[request.symbol]
            results[request.symbol] = _merge_symbol_result(current, requested=1)
            try:
                response = await self._fetch_with_retries(request)
                network_requests += response.attempts
                candles = normalize_history_response(request, response.payload)
                write = self.repository.upsert_candles("fyers", candles, request.request_id)
                results[request.symbol] = _merge_symbol_result(
                    results[request.symbol],
                    fetched_candles=len(candles),
                    inserted=write.inserted,
                    updated=write.updated,
                    unchanged=write.unchanged,
                    conflicts=write.conflicts,
                )
            except (AcquisitionError, ValueError) as exc:
                network_requests += getattr(exc, "attempts", 0)
                results[request.symbol] = _merge_symbol_result(results[request.symbol], failed=1, error=_safe_error(exc))
            if self.limits.request_pacing_seconds > 0:
                await asyncio.sleep(self.limits.request_pacing_seconds)
        return AcquisitionResult(plan=plan, executed=True, network_requests=network_requests, symbols=list(results.values()))

    async def _fetch_with_retries(self, request: FetchRequest):
        attempts = 0
        backoff = self.limits.initial_backoff_seconds
        while True:
            attempts += 1
            try:
                payload = await self.provider.history(request.symbol, request.resolution, request.start_epoch, request.end_epoch)
                code = _response_code(payload)
                status = str(payload.get("s", "")).lower() if isinstance(payload, dict) else ""
                if status == "ok":
                    return _ProviderResponse(payload=payload, attempts=attempts)
                if code in AUTH_STATUS_CODES:
                    raise AuthenticationRequiredError(_response_message(payload))
                if code in INVALID_STATUS_CODES:
                    raise InvalidHistoryRequestError(_response_message(payload))
                if code in TRANSIENT_STATUS_CODES:
                    raise TransientHistoryError(_response_message(payload))
                raise InvalidHistoryRequestError(_response_message(payload))
            except TransientHistoryError as exc:
                if attempts > self.limits.max_retries:
                    exc.attempts = attempts  # type: ignore[attr-defined]
                    raise
                await asyncio.sleep(min(backoff, self.limits.max_backoff_seconds))
                backoff = min(backoff * 2, self.limits.max_backoff_seconds)
            except AuthenticationRequiredError as exc:
                exc.attempts = attempts  # type: ignore[attr-defined]
                raise
            except InvalidHistoryRequestError as exc:
                exc.attempts = attempts  # type: ignore[attr-defined]
                raise
            except (httpx.RequestError, OSError) as exc:
                transient = TransientHistoryError("Transient provider network failure.")
                if attempts > self.limits.max_retries:
                    transient.attempts = attempts  # type: ignore[attr-defined]
                    raise transient from exc
                await asyncio.sleep(min(backoff, self.limits.max_backoff_seconds))
                backoff = min(backoff * 2, self.limits.max_backoff_seconds)
            except (TypeError, ValueError) as exc:
                invalid = InvalidHistoryRequestError("Provider returned an invalid history response.")
                invalid.attempts = attempts  # type: ignore[attr-defined]
                raise invalid from exc


@dataclass(frozen=True)
class _ProviderResponse:
    payload: dict[str, Any]
    attempts: int


def normalize_history_response(request: FetchRequest, payload: dict[str, Any]) -> list[NormalizedCandle]:
    candles = payload.get("candles")
    if not isinstance(candles, list):
        raise InvalidHistoryRequestError("Provider response did not contain a candle list.")
    normalized: dict[int, NormalizedCandle] = {}
    for row in candles:
        if not isinstance(row, (list, tuple)) or len(row) < 6:
            raise InvalidHistoryRequestError("Provider returned a malformed candle row.")
        try:
            timestamp = datetime.fromtimestamp(_finite_float(row[0]), timezone.utc).astimezone(IST)
            open_price = _finite_float(row[1])
            high = _finite_float(row[2])
            low = _finite_float(row[3])
            close = _finite_float(row[4])
            volume = _finite_float(row[5])
        except (TypeError, ValueError) as exc:
            raise InvalidHistoryRequestError("Provider returned non-finite OHLCV data.") from exc
        if min(open_price, high, low, close) < 0 or volume < 0:
            raise InvalidHistoryRequestError("Provider returned negative OHLCV data.")
        if high < max(open_price, close, low) or low > min(open_price, close, high):
            raise InvalidHistoryRequestError("Provider returned inconsistent OHLC data.")
        epoch = int(timestamp.timestamp())
        if epoch < request.start_epoch or epoch > request.end_epoch:
            raise InvalidHistoryRequestError("Provider returned a candle outside the requested range.")
        if not is_nse_session(timestamp, request.resolution):
            raise InvalidHistoryRequestError("Provider returned a candle outside the NSE cash session.")
        candle = NormalizedCandle(
            symbol=request.symbol,
            resolution=request.resolution,
            timestamp=timestamp,
            open=open_price,
            high=high,
            low=low,
            close=close,
            volume=volume,
        )
        existing = normalized.get(epoch)
        if existing is not None and existing != candle:
            raise InvalidHistoryRequestError("Provider returned conflicting candles for one timestamp.")
        normalized[epoch] = candle
    return [normalized[epoch] for epoch in sorted(normalized)]


def _finite_float(value: Any) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("non-finite number")
    return number


def _response_code(payload: dict[str, Any]) -> int:
    try:
        return int(payload.get("code", 0))
    except (TypeError, ValueError):
        return 0


def _response_message(payload: dict[str, Any]) -> str:
    message = str(payload.get("message") or payload.get("s") or "History request failed.")
    return _redact_sensitive(message)


def _safe_error(error: BaseException) -> str:
    return _redact_sensitive(str(error) or error.__class__.__name__)


def _redact_sensitive(message: str) -> str:
    patterns = ("authorization", "bearer", "token", "secret", "cookie", "password")
    lower = message.lower()
    if any(pattern in lower for pattern in patterns):
        return "Provider request failed with sensitive details redacted."
    return message


def _merge_symbol_result(
    current: SymbolAcquisitionResult,
    requested: int = 0,
    fetched_candles: int = 0,
    inserted: int = 0,
    updated: int = 0,
    unchanged: int = 0,
    conflicts: int = 0,
    failed: int = 0,
    error: str | None = None,
) -> SymbolAcquisitionResult:
    errors = [*current.errors]
    if error:
        errors.append(error)
    return SymbolAcquisitionResult(
        symbol=current.symbol,
        requested=current.requested + requested,
        fetched_candles=current.fetched_candles + fetched_candles,
        inserted=current.inserted + inserted,
        updated=current.updated + updated,
        unchanged=current.unchanged + unchanged,
        conflicts=current.conflicts + conflicts,
        failed=current.failed + failed,
        errors=errors,
    )
