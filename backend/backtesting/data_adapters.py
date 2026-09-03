from __future__ import annotations

import csv
import hashlib
import math
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo

from backend.scanner_engine.indicators import _completed_candles

from .schemas import CsvLoadReport, NormalizedCandle, Rejection

IST = ZoneInfo("Asia/Kolkata")
REQUIRED_COLUMNS = ("symbol", "resolution", "timestamp", "open", "high", "low", "close", "volume")


def parse_timestamp(value: Any) -> datetime:
    text = str(value or "").strip()
    if not text:
        raise ValueError("timestamp is required")
    if text.replace(".", "", 1).isdigit():
        numeric = float(text)
        if numeric >= 10_000_000_000:
            numeric /= 1000
        return datetime.fromtimestamp(numeric, timezone.utc).astimezone(IST)

    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError("timestamp must be epoch seconds or ISO-8601") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=IST)
    return parsed.astimezone(IST)


def resolution_seconds(resolution: str) -> int | None:
    key = str(resolution or "").strip().upper()
    return {"1": 60, "5": 300, "15": 900, "60": 3600, "D": 86400}.get(key)


def candle_completion_time(candle: NormalizedCandle) -> datetime | None:
    seconds = resolution_seconds(candle.resolution)
    if seconds is None:
        return None
    completion_epoch = int(candle.timestamp.timestamp()) + seconds
    if str(candle.resolution).strip().upper() == "D":
        local = candle.timestamp.astimezone(IST)
        if local.weekday() >= 5:
            return None
        return local.replace(hour=15, minute=30, second=0, microsecond=0)
    return datetime.fromtimestamp(completion_epoch, IST)


def is_nse_session(timestamp: datetime, resolution: str) -> bool:
    local = timestamp.astimezone(IST)
    if local.weekday() >= 5:
        return False
    if str(resolution).strip().upper() == "D":
        return True
    minutes = local.hour * 60 + local.minute
    return (9 * 60 + 15) <= minutes < (15 * 60 + 30)


def validate_ohlcv(row: dict[str, Any], row_number: int) -> NormalizedCandle:
    missing = [name for name in REQUIRED_COLUMNS if row.get(name) in (None, "")]
    if missing:
        raise ValueError(f"missing required column(s): {', '.join(missing)}")
    symbol = str(row["symbol"]).strip().upper()
    resolution = str(row["resolution"]).strip()
    if not symbol:
        raise ValueError("symbol is required")
    if resolution_seconds(resolution) is None:
        raise ValueError("unsupported resolution")
    timestamp = parse_timestamp(row["timestamp"])
    try:
        open_price = float(row["open"])
        high = float(row["high"])
        low = float(row["low"])
        close = float(row["close"])
        volume = float(row["volume"])
    except (TypeError, ValueError) as exc:
        raise ValueError("OHLCV fields must be numeric") from exc
    if not all(math.isfinite(value) for value in (open_price, high, low, close, volume)):
        raise ValueError("OHLCV fields must be finite")
    if min(open_price, high, low, close) < 0 or volume < 0:
        raise ValueError("negative price or volume")
    if high < max(open_price, close, low):
        raise ValueError("high is below open, close, or low")
    if low > min(open_price, close, high):
        raise ValueError("low is above open, close, or high")
    if not is_nse_session(timestamp, resolution):
        raise ValueError("timestamp is outside NSE session")
    return NormalizedCandle(
        symbol=symbol,
        resolution=resolution.upper(),
        timestamp=timestamp,
        open=open_price,
        high=high,
        low=low,
        close=close,
        volume=volume,
    )


def load_csv(path: str | Path) -> tuple[list[NormalizedCandle], CsvLoadReport]:
    source = Path(path)
    content = source.read_bytes()
    fingerprint = hashlib.sha256(content).hexdigest()
    rejections: list[Rejection] = []
    records: dict[tuple[str, str, int], NormalizedCandle] = {}
    duplicates = 0
    with source.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row_number, row in enumerate(reader, start=2):
            try:
                candle = validate_ohlcv(row, row_number)
            except ValueError as exc:
                rejections.append(Rejection(row_number=row_number, reason=str(exc)))
                continue
            key = (candle.symbol, candle.resolution, candle.epoch)
            if key in records:
                duplicates += 1
            records[key] = candle
    candles = sorted(records.values(), key=lambda candle: (candle.symbol, candle.resolution, candle.timestamp, candle.close))
    report = CsvLoadReport(
        accepted=len(candles),
        rejected=len(rejections),
        duplicate_count=duplicates,
        rejections=rejections,
        dataset_fingerprint=fingerprint,
    )
    return candles, report


def completed_candles(
    candles: Iterable[NormalizedCandle],
    replay_at: datetime,
    symbol: str | None = None,
    resolution: str | None = None,
) -> list[NormalizedCandle]:
    local_replay = replay_at.astimezone(IST)
    candidates = [
        candle for candle in candles
        if (symbol is None or candle.symbol == symbol.upper())
        and (resolution is None or candle.resolution == resolution.upper())
        and candle.timestamp <= local_replay
    ]
    if not candidates:
        return []
    selected_resolution = resolution or candidates[0].resolution
    raw = [candle.scanner_row() for candle in candidates]
    completed_epochs = {int(row[0]) for row in _completed_candles(raw, selected_resolution, now=int(local_replay.timestamp()))}
    return [candle for candle in candidates if candle.epoch in completed_epochs]


def rejection_counts(report: CsvLoadReport) -> dict[str, int]:
    return dict(Counter(row.reason for row in report.rejections))
