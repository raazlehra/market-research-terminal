import type { ConfidenceFactors, ConfidenceResult } from "./types";
import {
  calculateGreeksFavor,
  calculateIVExtreme,
  calculateLiquidity,
  calculateVolumeCluster,
  calculateWriterPositioning,
  detectWriterEvent,
} from "./factors";
import { calculateTrendAlignment, calculateTrendConfluence, calculateTrendDirection } from "./trend";

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
      return {
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
        signal: "LOADING",
        strength: "WEAK",
      };
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

    const normalizedScore =
      (factors.trendAlignment / FACTOR_MAX.trendAlignment) * FACTOR_WEIGHTS.trendAlignment +
      (factors.greeksFavor / FACTOR_MAX.greeksFavor) * FACTOR_WEIGHTS.greeksFavor +
      (factors.ivExtreme / FACTOR_MAX.ivExtreme) * FACTOR_WEIGHTS.ivExtreme +
      (factors.volumeCluster / FACTOR_MAX.volumeCluster) * FACTOR_WEIGHTS.volumeCluster +
      (factors.writerUnwind / FACTOR_MAX.writerUnwind) * FACTOR_WEIGHTS.writerUnwind +
      (factors.liquidity / FACTOR_MAX.liquidity) * FACTOR_WEIGHTS.liquidity +
      (factors.trendConfluence / FACTOR_MAX.trendConfluence) * FACTOR_WEIGHTS.trendConfluence;

    const probability = Math.max(0, Math.min(100, Math.round(normalizedScore * 100)));

    let strength: "WEAK" | "MODERATE" | "STRONG" | "VERY_STRONG" = "WEAK";
    let signal = "";

    if (probability >= 80) {
      strength = "VERY_STRONG";
      signal = isCall ? "BUY_CE" : "BUY_PE";
    } else if (probability >= 65) {
      strength = "STRONG";
      signal = isCall ? "BUY_CE" : "BUY_PE";
    } else if (probability >= 50) {
      strength = "MODERATE";
      signal = isCall ? "CE_OK" : "PE_OK";
    } else {
      strength = "WEAK";
      signal = isCall ? "CE_WEAK" : "PE_WEAK";
    }

    return {
      score: probability,
      factors,
      signal,
      strength,
      writerEvent,
    };
  } catch (error) {
    console.error("Error in calculateConfidence:", error);
    return {
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
      signal: "ERROR",
      strength: "WEAK",
    };
  }
}
