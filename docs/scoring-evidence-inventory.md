# Scoring Evidence Inventory

This inventory records known repeated evidence use in the current rule-based scoring model. It is documentation only; Phase 1 does not remove, cap, or reweight these features.

## Reused Trend Evidence

- `backend/scanner_engine/scoring.py`: scanner trend points use price versus VWAP plus EMA20/EMA50 alignment.
- `src/lib/confidence/trend.ts`: option-contract signal strength also uses VWAP and EMA20/EMA50 alignment.
- `src/lib/optionChainModel.ts`: final confluence adds market-flow trend, VWAP signal, and backend OHLCV analysis direction.
- `backend/market_analysis.py`: OHLCV analysis score includes EMA/VWAP direction and multi-timeframe agreement.

Risk: the same underlying price/VWAP/EMA evidence can contribute through scanner score, option contract score, market-flow score, and chart/OHLCV score.

## Reused OI Evidence

- `src/lib/optionChainModel.ts`: PCR, writer signal, support/resistance rows, and recommended contract selection all use current-chain OI/OI change.
- `src/lib/confidence/factors.ts`: volume cluster uses OI, OI change, and same-side OI concentration.
- `src/lib/confidence/factors.ts`: writer positioning separately uses same-side and opposite-side OI change.

Risk: current-chain OI and OI-change evidence can be counted in PCR, writer positioning, volume cluster, support/resistance strength, and final market-flow confluence.

## Validation Requirement

Backtesting and calibration should determine whether these correlated components should be grouped, capped, removed, or reweighted. Until then, scores should be presented as rule-based confluence, not predicted probability.
