# Phase 2 Slice 2: Read-Only Equity OHLCV Acquisition

This slice adds safe, read-only NSE equity historical-candle acquisition and an incremental local cache for the offline backtester. The deterministic replay engine remains offline: replay, execution, metrics, and calibration do not import or initialize FYERS clients.

## Scope

- Supported input symbols: explicit NSE equity symbols in `NSE:...-EQ` form.
- Supported resolutions: `5`, `15`, and `60` minute candles.
- Supported provider operation: historical market-data retrieval only.
- Not implemented: option-contract acquisition, option profitability backtesting, frontend pages, public API routes, paper orders, or live orders.

## Safety Model

Fetches default to dry-run/request-plan mode and make zero network calls. Real history acquisition requires `fetch-equity --execute-read-only`.

The CLI does not accept credentials, tokens, cookies, authorization headers, arbitrary URLs, or account identifiers. When execution is explicitly enabled, authentication is obtained only through the existing application FYERS state. Missing authentication fails closed.

The acquisition package does not reference order placement, order modification, cancellation, position exit, square-off, `PaperOrderMixin`, or live broker mutation APIs. Existing live-trading 403 protections are not changed.

## Provider Notes

The FYERS public market-data reference describes historical candles at `GET /data/history`, with `symbol`, `resolution`, `date_format`, `range_from`, `range_to`, and optional `cont_flag`/`oi_flag`. It documents candle rows as:

```text
[epoch, open, high, low, close, volume]
```

It also lists minute resolutions including `5`, `15`, and `60`, and documents a 100-day per-request cap for minute history. The current numeric market-data rate limit and expired-symbol availability are not hard-coded because they were not independently confirmed in the provider documentation. Request pacing, retry count, backoff, and chunk size remain configurable; HTTP 429 responses trigger bounded retry handling.

Provider rows are accepted only when their timestamps fall inside the requested range and the NSE cash session. Rows are sorted by timestamp, identical duplicates are collapsed, and conflicting duplicates, malformed OHLCV, and out-of-range/off-session candles fail closed. An empty successful response writes nothing and remains eligible for a later fetch.

## Cache

Default cache path:

```text
backtest-data/equity-history.sqlite3
```

`backtest-data/` is ignored by Git. Tests use temporary paths.

SQLite table:

```text
historical_candles(
  provider,
  symbol,
  resolution,
  timestamp,
  timestamp_utc,
  timezone,
  open,
  high,
  low,
  close,
  volume,
  fetched_at,
  source_request_id,
  schema_version,
  primary key(provider, symbol, resolution, timestamp)
)
```

The cache stores normalized UTC timestamps plus explicit `Asia/Kolkata` interpretation metadata. It stores no token, authorization, account, or raw broker-response metadata.

## Incremental Behaviour

Before fetching, the service checks cached weekday coverage per provider, symbol, and resolution. A day is complete only after the cache contains a full expected NSE session (`75` five-minute, `25` fifteen-minute, or `7` sixty-minute candles). Incomplete weekdays remain eligible for refetch, while weekends are not requested. Exchange holidays are not modelled, so a holiday inside a requested range may remain eligible for a later fetch. Requests are chunked deterministically and writes are transactional.

Duplicate candles with identical OHLCV are counted as unchanged. Duplicate keys with different OHLCV are counted as conflicts and resolved deterministically by replacing with the latest normalized provider value. Interrupted or failed writes roll back the current transaction and leave existing cached candles valid.

The historical cache has no time-based expiry. This avoids silently changing reproducible datasets. To deliberately rebuild from provider corrections, use a fresh cache path; no credential or raw provider-response metadata is stored.

## Retry Behaviour

Transient provider responses with status codes `429`, `500`, `502`, `503`, or `504`, plus HTTP transport/network failures, are retried with bounded exponential backoff. Authentication responses (`401`, `403`) and invalid request/not-found responses (`400`, `404`, `422`) are classified separately and fail without retry. Error text is redacted if it contains sensitive terms.

Historical provider limits other than the documented minute range cap are deliberately not hard-coded.

## CLI Workflow

Plan without network:

```powershell
python -m backend.backtesting.cli plan-fetch --symbols NSE:SBIN-EQ --resolution 5 --start-date 2026-09-01 --end-date 2026-09-01 --cache-db backtest-data/equity-history.sqlite3
```

Execute only after explicit approval:

```powershell
python -m backend.backtesting.cli fetch-equity --symbols NSE:SBIN-EQ --resolution 5 --start-date 2026-09-01 --end-date 2026-09-01 --cache-db backtest-data/equity-history.sqlite3 --execute-read-only
```

Inspect cache:

```powershell
python -m backend.backtesting.cli cache-status --cache-db backtest-data/equity-history.sqlite3
```

Export normalized CSV:

```powershell
python -m backend.backtesting.cli export-csv --symbols NSE:SBIN-EQ --resolution 5 --cache-db backtest-data/equity-history.sqlite3 --output backtest-results/sbin-5m.csv
```

Invalid provider-limit values, corrupt cache databases, invalid symbols/dates, and confirmed acquisition failures return a non-zero CLI status without deleting or replacing the cache.

Run the existing offline backtest:

```powershell
python -m backend.backtesting.cli run --csv backtest-results/sbin-5m.csv --strategy BREAKOUT --symbols NSE:SBIN-EQ --resolution 5 --score-threshold 50 --fixed-quantity 1
```

## Interpretation

This slice only acquires equity OHLCV and exports it into the Slice 1 CSV schema. It does not validate option profitability, option-chain liquidity, Greeks, implied volatility, margin, or option execution. Rule Score bands remain empirical outcome buckets, not probabilities.

## Data Responsibility

Downloaded market data, cache databases, and exported result files are runtime artifacts. Keep them out of Git and follow the provider's licensing and usage terms.
