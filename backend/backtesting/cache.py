from __future__ import annotations

import csv
import math
import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from .acquisition import DateRange
from .data_adapters import IST
from .replay import _fingerprint_candles
from .schemas import NormalizedCandle

CACHE_SCHEMA_VERSION = "historical_candles.v1"
DEFAULT_CACHE_PATH = Path("backtest-data/equity-history.sqlite3")
EXPECTED_CANDLES_PER_SESSION = {"5": 75, "15": 25, "60": 7}


@dataclass(frozen=True)
class CacheWriteResult:
    inserted: int
    updated: int
    unchanged: int
    conflicts: int


@dataclass(frozen=True)
class CacheStatus:
    path: str
    candle_count: int
    symbols: list[str]
    resolutions: list[str]
    earliest: str | None
    latest: str | None


class HistoricalCandleRepository:
    def __init__(self, path: str | Path = DEFAULT_CACHE_PATH) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _init_schema(self) -> None:
        with closing(self._connect()) as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS historical_candles (
                    provider TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    resolution TEXT NOT NULL,
                    timestamp INTEGER NOT NULL,
                    timestamp_utc TEXT NOT NULL,
                    timezone TEXT NOT NULL,
                    open REAL NOT NULL,
                    high REAL NOT NULL,
                    low REAL NOT NULL,
                    close REAL NOT NULL,
                    volume REAL NOT NULL,
                    fetched_at TEXT NOT NULL,
                    source_request_id TEXT NOT NULL,
                    schema_version TEXT NOT NULL,
                    PRIMARY KEY (provider, symbol, resolution, timestamp)
                )
                """
            )
            connection.commit()

    def upsert_candles(self, provider: str, candles: list[NormalizedCandle], source_request_id: str) -> CacheWriteResult:
        inserted = updated = unchanged = conflicts = 0
        fetched_at = datetime.now(timezone.utc).isoformat()
        with closing(self._connect()) as connection:
            cursor = connection.cursor()
            cursor.execute("BEGIN")
            try:
                for candle in candles:
                    _validate_candle(candle)
                    existing = cursor.execute(
                        """
                        SELECT open, high, low, close, volume FROM historical_candles
                        WHERE provider = ? AND symbol = ? AND resolution = ? AND timestamp = ?
                        """,
                        (provider, candle.symbol, candle.resolution, candle.epoch),
                    ).fetchone()
                    values = (candle.open, candle.high, candle.low, candle.close, candle.volume)
                    if existing is None:
                        inserted += 1
                    elif tuple(float(item) for item in existing) == values:
                        unchanged += 1
                    else:
                        conflicts += 1
                        updated += 1
                    cursor.execute(
                        """
                        INSERT INTO historical_candles (
                            provider, symbol, resolution, timestamp, timestamp_utc, timezone,
                            open, high, low, close, volume, fetched_at, source_request_id, schema_version
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(provider, symbol, resolution, timestamp) DO UPDATE SET
                            timestamp_utc = excluded.timestamp_utc,
                            timezone = excluded.timezone,
                            open = excluded.open,
                            high = excluded.high,
                            low = excluded.low,
                            close = excluded.close,
                            volume = excluded.volume,
                            fetched_at = excluded.fetched_at,
                            source_request_id = excluded.source_request_id,
                            schema_version = excluded.schema_version
                        """,
                        (
                            provider,
                            candle.symbol,
                            candle.resolution,
                            candle.epoch,
                            candle.timestamp.astimezone(timezone.utc).isoformat(),
                            "Asia/Kolkata",
                            candle.open,
                            candle.high,
                            candle.low,
                            candle.close,
                            candle.volume,
                            fetched_at,
                            source_request_id,
                            CACHE_SCHEMA_VERSION,
                        ),
                    )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        return CacheWriteResult(inserted=inserted, updated=updated, unchanged=unchanged, conflicts=conflicts)

    def get_candles(
        self,
        provider: str,
        symbols: list[str],
        resolution: str,
        start: date | None = None,
        end: date | None = None,
    ) -> list[NormalizedCandle]:
        if not symbols:
            raise ValueError("At least one symbol is required to read cached candles.")
        params: list[object] = [provider, resolution, *symbols]
        clauses = ["provider = ?", "resolution = ?", f"symbol IN ({','.join('?' for _ in symbols)})"]
        if start is not None:
            clauses.append("timestamp >= ?")
            params.append(int(datetime.combine(start, datetime.min.time(), tzinfo=IST).timestamp()))
        if end is not None:
            clauses.append("timestamp <= ?")
            params.append(int(datetime.combine(end, datetime.max.time(), tzinfo=IST).timestamp()))
        query = f"""
            SELECT symbol, resolution, timestamp, open, high, low, close, volume
            FROM historical_candles
            WHERE {' AND '.join(clauses)}
            ORDER BY symbol, resolution, timestamp
        """
        with closing(self._connect()) as connection:
            rows = connection.execute(query, params).fetchall()
        return [
            NormalizedCandle(
                symbol=str(row[0]),
                resolution=str(row[1]),
                timestamp=datetime.fromtimestamp(int(row[2]), IST),
                open=float(row[3]),
                high=float(row[4]),
                low=float(row[5]),
                close=float(row[6]),
                volume=float(row[7]),
            )
            for row in rows
        ]

    def export_csv(self, output_path: str | Path, symbols: list[str], resolution: str, start: date | None = None, end: date | None = None) -> Path:
        candles = self.get_candles("fyers", symbols, resolution, start, end)
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["symbol", "resolution", "timestamp", "open", "high", "low", "close", "volume"])
            for candle in candles:
                writer.writerow([candle.symbol, candle.resolution, candle.timestamp.astimezone(IST).isoformat(), candle.open, candle.high, candle.low, candle.close, candle.volume])
        return path

    def dataset_fingerprint(self, symbols: list[str], resolution: str, start: date | None = None, end: date | None = None) -> str:
        return _fingerprint_candles(self.get_candles("fyers", symbols, resolution, start, end))

    def status(self) -> CacheStatus:
        with closing(self._connect()) as connection:
            count = int(connection.execute("SELECT COUNT(*) FROM historical_candles").fetchone()[0])
            symbols = [str(row[0]) for row in connection.execute("SELECT DISTINCT symbol FROM historical_candles ORDER BY symbol")]
            resolutions = [str(row[0]) for row in connection.execute("SELECT DISTINCT resolution FROM historical_candles ORDER BY resolution")]
            bounds = connection.execute("SELECT MIN(timestamp), MAX(timestamp) FROM historical_candles").fetchone()
        earliest = datetime.fromtimestamp(int(bounds[0]), IST).isoformat() if bounds and bounds[0] is not None else None
        latest = datetime.fromtimestamp(int(bounds[1]), IST).isoformat() if bounds and bounds[1] is not None else None
        return CacheStatus(path=str(self.path), candle_count=count, symbols=symbols, resolutions=resolutions, earliest=earliest, latest=latest)

    def missing_date_ranges(self, provider: str, symbol: str, resolution: str, start: date, end: date) -> list[DateRange]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """
                SELECT date(timestamp, 'unixepoch', '+5 hours', '+30 minutes'), COUNT(*)
                FROM historical_candles
                WHERE provider = ? AND symbol = ? AND resolution = ?
                  AND timestamp >= ? AND timestamp <= ?
                GROUP BY 1
                ORDER BY 1
                """,
                (
                    provider,
                    symbol,
                    resolution,
                    int(datetime.combine(start, datetime.min.time(), tzinfo=IST).timestamp()),
                    int(datetime.combine(end, datetime.max.time(), tzinfo=IST).timestamp()),
                ),
            ).fetchall()
        expected = EXPECTED_CANDLES_PER_SESSION.get(resolution)
        cached = {
            date.fromisoformat(str(row[0]))
            for row in rows
            if row[0] and expected is not None and int(row[1]) >= expected
        }
        requested_days = [start + timedelta(days=offset) for offset in range((end - start).days + 1)]
        missing_days = [day for day in requested_days if day.weekday() < 5 and day not in cached]
        return _coalesce_days(missing_days)


def _coalesce_days(days: list[date]) -> list[DateRange]:
    if not days:
        return []
    ranges: list[DateRange] = []
    range_start = previous = days[0]
    for current in days[1:]:
        if current == previous + timedelta(days=1):
            previous = current
            continue
        ranges.append(DateRange(range_start, previous))
        range_start = previous = current
    ranges.append(DateRange(range_start, previous))
    return ranges


def _validate_candle(candle: NormalizedCandle) -> None:
    values = (candle.open, candle.high, candle.low, candle.close, candle.volume)
    if not all(math.isfinite(value) for value in values):
        raise ValueError("OHLCV values must be finite.")
    if min(candle.open, candle.high, candle.low, candle.close) < 0 or candle.volume < 0:
        raise ValueError("OHLCV values cannot be negative.")
    if candle.high < max(candle.open, candle.close, candle.low):
        raise ValueError("High is below open, close, or low.")
    if candle.low > min(candle.open, candle.close, candle.high):
        raise ValueError("Low is above open, close, or high.")
