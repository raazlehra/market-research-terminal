import { calculateGreeks } from "./greeks";
import { calculateConfidence, calculateIVPercentile } from "./confidence";

export type ConfidenceFactors = {
  trendAlignment: number;
  greeksFavor: number;
  ivExtreme: number;
  volumeCluster: number;
  writerUnwind: number;
  liquidity: number;
  trendConfluence: number;
};

export type ConfidenceResult = {
  score: number;
  factors: ConfidenceFactors;
  signal: string;
  strength: "WEAK" | "MODERATE" | "STRONG" | "VERY_STRONG";
};

export type CalculateRealConfidenceParams = {
  rows: any[];
  strike: number;
  side: "CE" | "PE";
  spot: number;
  vwap: number | null;
  ema20: number | null;
  ema50: number | null;
  data: any;
  timeToExpiryYears: number;
  avgIV: number;
  ivHistory: number[];
  totalCeOI: number;
  totalPeOI: number;
};

const defaultResult: ConfidenceResult = {
  score: 0,
  factors: {
    trendAlignment: 0,
    greeksFavor: 0,
    ivExtreme: 0,
    volumeCluster: 0,
    writerUnwind: 0,
    liquidity: 0,
    trendConfluence: 0,
  },
  signal: "",
  strength: "WEAK",
};

function positiveNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function medianPositive(values: number[]): number {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 0;

  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function getSideVolumeBaseline(rows: any[], side: "CE" | "PE"): number {
  return medianPositive(rows.map((row) => positiveNumber(side === "CE" ? row.ce?.volume : row.pe?.volume)));
}

function getOptionPriceChangePct(optionData: any): number {
  return finiteNumber(optionData?.price_change_pct)
    ?? finiteNumber(optionData?.change_pct)
    ?? finiteNumber(optionData?.chp)
    ?? finiteNumber(optionData?.ltpch)
    ?? 0;
}

export function calculateRealConfidence(params: CalculateRealConfidenceParams): ConfidenceResult {
  const {
    rows,
    strike,
    side,
    spot,
    vwap,
    ema20,
    ema50,
    data,
    timeToExpiryYears,
    avgIV,
    ivHistory,
    totalCeOI,
    totalPeOI,
  } = params;

  const row = rows.find((r) => r.strike === strike);
  if (!row) return defaultResult;

  const isCall = side === "CE";
  const optionData = isCall ? row.ce : row.pe;
  const otherData = isCall ? row.pe : row.ce;

  if (!optionData) return defaultResult;

  const optionIV = positiveNumber(optionData.iv) || positiveNumber(avgIV) || 20;
  const avgVolume = getSideVolumeBaseline(rows, side);
  const optionPriceChangePct = getOptionPriceChangePct(optionData);

  const greeks = calculateGreeks(
    spot,
    strike,
    timeToExpiryYears,
    0.07,
    optionIV / 100,
    isCall ? "call" : "put"
  );

  return calculateConfidence({
    spot,
    strike,
    vwap,
    ema20,
    ema50,
    vwap15: data.vwap15 ?? null,
    ema2015: data.ema2015 ?? null,
    ema5015: data.ema5015 ?? null,
    vwap60: data.vwap60 ?? null,
    ema2060: data.ema2060 ?? null,
    ema5060: data.ema5060 ?? null,
    isCall,
    delta: greeks.delta,
    gamma: greeks.gamma,
    theta: greeks.theta,
    currentIV: optionIV,
    avgIV,
    ivPercentile: calculateIVPercentile(optionIV, ivHistory),
    volume: optionData.volume ?? 0,
    oi: optionData.oi ?? 0,
    avgVolume,
    oiChange: optionData.oi_change ?? 0,
    priceChangePct: optionPriceChangePct,
    otherSideOiChange: otherData?.oi_change ?? 0,
    otherSideOI: otherData?.oi ?? 0,
    bid: optionData.bid ?? 0,
    ask: optionData.ask ?? 0,
    allRows: rows,
    totalOI: isCall ? totalCeOI : totalPeOI,
  });
}
