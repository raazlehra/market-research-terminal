import type { CandlestickSignal } from "../../lib/candlestickPatterns";
import type { MarketRegimeSignal } from "../../lib/marketRegime";
import type { PatternConfidenceAdjustment } from "../../lib/patternConfidence";
import type { AutoBotState } from "./types";

type OptionWatchCandleRule = {
  signal: CandlestickSignal;
  regime: MarketRegimeSignal;
};

type OptionWatchSelectionCandidate = {
  indexInfo: {
    label: string;
  };
  score: number;
  candleRule: OptionWatchCandleRule;
  patternAdjustment: Pick<PatternConfidenceAdjustment, "adjustment" | "sample">;
  snapshot: {
    confluenceScore: number;
  };
  adjustedConfluence: number;
};

type WatchBlockDetailsInput = {
  optionSide: "CE" | "PE";
  finalScore: number;
  liquidityScore: number;
  expiryScore: number;
  chartScore: number;
  candleRule: OptionWatchCandleRule;
  regimeBlock: string;
  regimeGuardMinScore: number;
  patternAdjustment: Pick<PatternConfidenceAdjustment, "adjustment" | "sample">;
  confidenceBefore: number;
  confidenceAfter: number;
  entry: number;
  sl: number;
  t1: number;
  t2: number;
  qty: number;
  timeframe: string;
};

export function optionWatchBlockDetails(input: WatchBlockDetailsInput): Record<string, unknown> {
  return {
    optionSide: input.optionSide,
    finalScore: Math.round(input.finalScore),
    liquidity: input.liquidityScore,
    expiry: input.expiryScore,
    chart: input.chartScore,
    candle: input.candleRule.signal.name,
    candleScore: input.candleRule.signal.score,
    candleVolume: input.candleRule.signal.confirmed,
    marketRegime: input.candleRule.regime.regime,
    regimeTrend: input.candleRule.regime.trendPct,
    regimeRange: input.candleRule.regime.rangePct,
    ...(input.regimeBlock ? { regimeGuardMinScore: input.regimeGuardMinScore } : {}),
    patternAdjustment: input.patternAdjustment.adjustment,
    patternSample: input.patternAdjustment.sample,
    confidenceBefore: input.confidenceBefore,
    confidenceAfter: input.confidenceAfter,
    entry: input.entry,
    sl: input.sl,
    t1: input.t1,
    t2: input.t2,
    qty: input.qty,
    candleTimeframe: input.timeframe,
  };
}

export function optionWatchSelectionDetails(
  best: OptionWatchSelectionCandidate,
  runnerUp: OptionWatchSelectionCandidate | undefined,
  bot: AutoBotState
): Record<string, unknown> {
  const details: Record<string, unknown> = {
    winner: best.indexInfo.label,
    winnerScore: Math.round(best.score),
    requestedLots: bot.optionIndexRisk[best.indexInfo.label]?.requestedLots || 1,
    maxLots: bot.optionIndexRisk[best.indexInfo.label]?.maxLots || 1,
    candle: best.candleRule.signal.name,
    candleScore: best.candleRule.signal.score,
    candleVolume: best.candleRule.signal.confirmed,
    marketRegime: best.candleRule.regime.regime,
    patternAdjustment: best.patternAdjustment.adjustment,
    patternSample: best.patternAdjustment.sample,
    confidenceBefore: best.snapshot.confluenceScore,
    confidenceAfter: best.adjustedConfluence,
  };

  if (runnerUp) {
    details.runnerUp = runnerUp.indexInfo.label;
    details.runnerUpScore = Math.round(runnerUp.score);
  }

  return details;
}
