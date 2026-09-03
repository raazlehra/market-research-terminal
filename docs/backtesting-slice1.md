# Phase 2 Slice 1: Offline Equity Scanner Backtesting

This slice adds a deterministic backend-only foundation for replaying equity scanner signals against local OHLCV CSV files. It does not add API routes, frontend pages, authenticated FYERS access, paper orders, live orders, or historical option backtesting.

## What Is Tested

- Offline CSV candle normalization and validation.
- Completed-candle replay with no system-clock dependency.
- Production scanner context, signal, Rule Score, stop, and target generation where inputs can be reconstructed from OHLCV.
- Deterministic next-candle equity execution with configurable fixed quantity, slippage, costs, stop/target/session/max-holding exits, and conservative tie-breaking.
- Trade metrics, equity curve, drawdown, losing streak, and empirical Rule Score bands.

## What Is Not Tested

- Historical option profitability.
- Option-chain state, Greeks, implied volatility, open interest, or lot-margin simulation.
- Historical brokerage/tax schedule changes.
- Broker order-book liquidity or partial fills.
- FYERS authentication, quotes, history, or mutation endpoints.

## CSV Schema

Required columns:

```text
symbol,resolution,timestamp,open,high,low,close,volume
```

Timestamps may be epoch seconds, epoch milliseconds, or ISO-8601. Naive ISO timestamps are interpreted as Asia/Kolkata. Intraday candles must fall inside the NSE cash session, 09:15 inclusive to 15:30 exclusive. Rows are sorted ascending and duplicate `symbol/resolution/timestamp` rows resolve deterministically by keeping the last row in file order.

Malformed OHLCV, negative prices or volume, `high` below any of open/close/low, `low` above any of open/close/high, unsupported resolutions, and out-of-session rows are rejected with counted reasons.

## Anti-Lookahead Replay Timeline

For each symbol and replay candle:

1. Compute the candle completion timestamp from the CSV timestamp plus resolution.
2. Expose only candles completed at that replay timestamp.
3. Preserve earlier candles before the requested start time for EMA, previous close, VWAP, ATR, and volume context.
4. Build the production scanner context from completed candles only.
5. Generate the production strategy signal.
6. Calculate the production Rule Score and score breakdown.
7. Schedule entry no earlier than the next executable candle open.
8. Execute exits only from candles at or after the entry candle.

The current candle close is never used as an earlier entry price.

## Strategy Compatibility

| Strategy | Slice 1 Status | Historical OHLCV Inputs |
| --- | --- | --- |
| `VOLUME_SPIKE` | Supported when prior session close exists | Reconstructs cumulative current-session volume and percentage change from previous completed session close. A single candle volume is not treated as daily volume. |
| `BREAKOUT_VOLUME` | Supported | Uses completed OHLCV for previous high, current candle volume, average volume, EMAs, VWAP, ATR, and candle body/wick checks. |
| `BREAKOUT` | Supported | Same OHLCV-derived context as production scanner. |
| `EMA_CROSS` | Supported after warm-up | Requires enough prior candles for EMA context. |
| `VWAP_BREAKOUT` | Supported after warm-up | Session VWAP resets at the NSE trading-session boundary. |

If the required historical inputs cannot be reconstructed, the run records an unsupported-data reason rather than fabricating values.

## Execution Assumptions

- Default entry is next candle open.
- Default position sizing is fixed equity quantity.
- Stop and target are frozen from the signal at decision time.
- Default exit is full quantity at stop, first target, session-end, or maximum holding bars.
- No overnight holding by default.
- Only one open position per symbol and strategy is allowed by default. Qualified signals while that position is open are skipped and counted in run metadata. Overlap requires an explicit execution-policy opt-in.
- A gap through stop fills at the worse of stop or next executable open.
- A favorable target gap fills at the target price, not at the better open.
- If stop and target are both touched in one candle and no lower-timeframe data exists, stop is assumed first.
- Tie-breaking is deterministic and the exit reason is stored.

## Cost And Slippage Assumptions

The default `paper_equity_v1` cost model reuses the existing pure paper charge function for equity-like unit turnover. Entry charges are counted once and exit charges are counted once. Adverse slippage is applied exactly once at entry and exactly once at exit. Historical tax and brokerage schedule changes are not modelled in this slice.

## Metrics

The result includes trade count, gross P&L, total charges, net P&L, entry notional, gross/net return, initial risk, R multiple, MAE, MFE, holding bars/time, win/loss/breakeven counts, expectancy in net currency and R, gross profit, gross loss, net-after-cost profit factor, equity curve, maximum drawdown, and longest losing streak.

Zero denominators produce `null`/unavailable metrics instead of invented defaults.

Profit factor is based on net-after-cost trade P&L. Gross profit and gross loss are still reported separately as clearly labelled gross figures.

## Rule Score Bands

Empirical bands are produced for `25-49`, `50-59`, `60-69`, `70-79`, `80-89`, and `90-95`. Each band reports count, wins, losses, breakeven, win rate, average gross/net return, average R, expectancy, net-after-cost profit factor where defined, and an insufficient-sample warning when applicable.

These are empirical outcome buckets, not probabilities. Small samples are not calibration.

Example band:

```json
{
  "band": "70-79",
  "observations": 1,
  "wins": 1,
  "losses": 0,
  "breakeven": 0,
  "win_rate": 1.0,
  "avg_gross_return_pct": 3.0,
  "avg_net_return_pct": 2.1,
  "avg_r": 1.2,
  "expectancy_net": 21.0,
  "profit_factor": null,
  "warning": "insufficient sample; empirical band is not calibrated"
}
```

## CLI

Run without FYERS authentication.

Positive golden example:

```powershell
python -m backend.backtesting.cli --csv .\backend\tests\fixtures\backtesting\golden_breakout_equity_ohlcv.csv --strategy BREAKOUT --symbols NSE:GOLDEN-EQ --resolution 5 --start 2026-09-02T09:15:00+05:30 --end 2026-09-02T09:45:00+05:30 --score-threshold 25 --fixed-quantity 10 --slippage-bps 0 --max-holding-bars 3
```

Expected summary shape:

```text
Backtest complete: run_id=... trades=1 gross_pnl=24.71 charges=2.95 net_pnl=21.76 gross_return=2.1867% net_return=1.9257% score_band_observations=1
```

Unsupported negative example:

```powershell
python -m backend.backtesting.cli --csv .\backend\tests\fixtures\backtesting\sample_equity_ohlcv.csv --strategy VOLUME_SPIKE --symbols NSE:TEST-EQ --resolution 5 --score-threshold 25 --fixed-quantity 1 --slippage-bps 0 --max-holding-bars 2
```

Expected summary shape:

```text
Backtest complete: run_id=... trades=0 gross_pnl=0.00 charges=0.00 net_pnl=0.00 gross_return=unavailable net_return=unavailable score_band_observations=0
Unsupported data reasons: 1
```

The CLI returns `0` for a valid supported run, including a supported run with zero signals. It returns `2` for invalid input or an unsupported dataset. Generated outputs should be written to configured temporary or ignored paths such as `backtest-results/`. Do not commit downloaded or user historical datasets.
