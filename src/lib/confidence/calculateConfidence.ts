import type { ConfidenceFactors, ConfidenceResult, RuleScoreDirection, ScoreBreakdownItem } from "./types";
import {
  calculateGreeksFavor,
  calculateIVExtreme,
  calculateLiquidity,
  calculateVolumeCluster,
  calculateWriterPositioning,
  detectWriterEvent,
} from "./factors";
import { calculateTrendAlignment, calculateTrendConfluence, calculateTrendDirection } from "./trend";

const SCORE_TYPE = "rule_based_confluence" as const;
const SCORE_RANGE: [0, 100] = [0, 100];

const FACTOR_WEIGHTS = {
  trendAlignment: 0.20,
  greeksFavor: 0.12,
  ivExtreme: 0.12,
  volumeCluster: 0.22,
  writerUnwind: 0.12,
  liquidity: 0.08,
  trendConfluence: 0.14,
};

const FACTOR_MAX = {
  trendAlignment: 15,
  greeksFavor: 10,
  ivExtreme: 15,
  volumeCluster: 15,
  writerUnwind: 8,
  liquidity: 10,
  trendConfluence: 8,
};

const zeroFactors: ConfidenceFactors = {
  trendAlignment: 0,
  greeksFavor: 0,
  ivExtreme: 0,
  volumeCluster: 0,
  writerUnwind: 0,
  liquidity: 0,
  trendConfluence: 0,
};

function emptyResult(signal: string): ConfidenceResult {
  return {
    score: 0,
    scoreType: SCORE_TYPE,
    calibrated: false,
    scoreRange: SCORE_RANGE,
    factors: zeroFactors,
    scoreBreakdown: [],
    signal,
    strength: "WEAK",
  };
}

export function calculateConfidence(options: {
  spot: number;
  strike: number;
  vwap: number | null;
  ema20: number | null;
  ema50: number | null;
  vwap15: number | null;
  ema2015: number | null;
  ema5015: number | null;
  vwap60: number | null;
  ema2060: number | null;
  ema5060: number | null;
  isCall: boolean;
  delta: number;
  gamma: number;
  theta: number;
  currentIV: number;
  avgIV: number;
  ivPercentile: number;
  volume: number;
  oi: number;
  avgVolume: number;
  oiChange: number;
  priceChangePct?: number;
  otherSideOiChange: number;
  otherSideOI?: number;
  allRows: any[];
  totalOI: number;
  bid: number;
  ask: number;
}): ConfidenceResult {
  try {
    const {
      spot,
      strike,
      vwap,
      ema20,
      ema50,
      vwap15,
      ema2015,
      ema5015,
      vwap60,
      ema2060,
      ema5060,
      isCall,
      delta,
      gamma,
      theta,
      currentIV,
      avgIV,
      ivPercentile,
      volume,
      oi,
      avgVolume,
      oiChange,
      priceChangePct = 0,
      otherSideOiChange,
      otherSideOI = 0,
      allRows,
      totalOI,
      bid,
      ask,
    } = options;

    if (!strike || !allRows || allRows.length === 0) {
      return emptyResult("LOADING");
    }

    const trendDirection5m = calculateTrendDirection(vwap, ema20, ema50);
    const trendDirection15m = calculateTrendDirection(vwap15, ema2015, ema5015);
    const trendDirection60m = calculateTrendDirection(vwap60, ema2060, ema5060);

    const factors: ConfidenceFactors = {
      trendAlignment: calculateTrendAlignment(spot, vwap, ema20, ema50, isCall),
      greeksFavor: calculateGreeksFavor(delta, gamma, theta, isCall),
      ivExtreme: calculateIVExtreme(currentIV, avgIV, ivPercentile),
      volumeCluster: calculateVolumeCluster(volume, oi, avgVolume, oiChange, totalOI),
      writerUnwind: calculateWriterPositioning(
        oiChange,
        otherSideOiChange,
        isCall ? spot > strike : spot < strike,
        oi,
        otherSideOI
      ),
      liquidity: calculateLiquidity(bid, ask, volume, oi, avgVolume),
      trendConfluence: calculateTrendConfluence(trendDirection5m, trendDirection15m, trendDirection60m),
    };

    const writerEvent = detectWriterEvent(oiChange, priceChangePct, isCall);

    const normalizedScore =
      (factors.trendAlignment / FACTOR_MAX.trendAlignment) * FACTOR_WEIGHTS.trendAlignment +
      (factors.greeksFavor / FACTOR_MAX.greeksFavor) * FACTOR_WEIGHTS.greeksFavor +
      (factors.ivExtreme / FACTOR_MAX.ivExtreme) * FACTOR_WEIGHTS.ivExtreme +
      (factors.volumeCluster / FACTOR_MAX.volumeCluster) * FACTOR_WEIGHTS.volumeCluster +
      (factors.writerUnwind / FACTOR_MAX.writerUnwind) * FACTOR_WEIGHTS.writerUnwind +
      (factors.liquidity / FACTOR_MAX.liquidity) * FACTOR_WEIGHTS.liquidity +
      (factors.trendConfluence / FACTOR_MAX.trendConfluence) * FACTOR_WEIGHTS.trendConfluence;

    const ruleScore = Math.max(0, Math.min(100, Math.round(normalizedScore * 100)));
    const scoreBreakdown = buildScoreBreakdown({
      factors,
      isCall,
      ivPercentile,
      currentIV,
      avgIV,
      volume,
      oi,
      avgVolume,
      oiChange,
      totalOI,
      bid,
      ask,
      trendDirection5m,
      trendDirection15m,
      trendDirection60m,
      spot,
      strike,
    });

    let strength: "WEAK" | "MODERATE" | "STRONG" | "VERY_STRONG" = "WEAK";
    let signal = "";

    if (ruleScore >= 80) {
      strength = "VERY_STRONG";
      signal = isCall ? "BUY_CE" : "BUY_PE";
    } else if (ruleScore >= 65) {
      strength = "STRONG";
      signal = isCall ? "BUY_CE" : "BUY_PE";
    } else if (ruleScore >= 50) {
      strength = "MODERATE";
      signal = isCall ? "CE_OK" : "PE_OK";
    } else {
      strength = "WEAK";
      signal = isCall ? "CE_WEAK" : "PE_WEAK";
    }

    return {
      score: ruleScore,
      scoreType: SCORE_TYPE,
      calibrated: false,
      scoreRange: SCORE_RANGE,
      factors,
      scoreBreakdown,
      signal,
      strength,
      writerEvent,
    };
  } catch (error) {
    console.error("Error in calculateConfidence:", error);
    return emptyResult("ERROR");
  }
}

function buildScoreBreakdown(input: {
  factors: ConfidenceFactors;
  isCall: boolean;
  ivPercentile: number;
  currentIV: number;
  avgIV: number;
  volume: number;
  oi: number;
  avgVolume: number;
  oiChange: number;
  totalOI: number;
  bid: number;
  ask: number;
  trendDirection5m: number;
  trendDirection15m: number;
  trendDirection60m: number;
  spot: number;
  strike: number;
}): ScoreBreakdownItem[] {
  const direction: RuleScoreDirection = input.isCall ? "bullish" : "bearish";
  const weighted = (key: keyof ConfidenceFactors) =>
    Math.round((input.factors[key] / FACTOR_MAX[key]) * FACTOR_WEIGHTS[key] * 1000) / 10;
  const item = (
    component: keyof ConfidenceFactors,
    rawValue: number | string | null,
    reason: string,
    missingData = false,
  ): ScoreBreakdownItem => ({
    component,
    rawValue,
    normalizedValue: Math.round((input.factors[component] / FACTOR_MAX[component]) * 1000) / 1000,
    weight: FACTOR_WEIGHTS[component],
    pointsContributed: weighted(component),
    direction,
    missingData,
    reason,
  });

  return [
    item("trendAlignment", `${input.spot}:${input.strike}`, "Spot/VWAP/EMA alignment for the selected option side.", !input.spot),
    item("greeksFavor", null, "Delta-positioning score for the selected option contract."),
    item("ivExtreme", input.ivPercentile, "Current-chain IV rank and IV versus current-chain average; not historical IV rank.", input.currentIV <= 0),
    item("volumeCluster", input.volume, "Contract volume, OI change, and same-side OI concentration."),
    item("writerUnwind", input.oiChange, "Same-side and opposite-side OI change interpreted as writer positioning."),
    item("liquidity", input.ask > 0 && input.bid > 0 ? (input.ask - input.bid) / input.ask : null, "Bid/ask spread, volume, and open interest liquidity."),
    item(
      "trendConfluence",
      `${input.trendDirection5m}/${input.trendDirection15m}/${input.trendDirection60m}`,
      "Agreement across 5m, 15m, and 60m trend directions.",
      input.trendDirection5m === 0 && input.trendDirection15m === 0 && input.trendDirection60m === 0,
    ),
  ];
}
