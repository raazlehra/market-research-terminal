import { calculateTrendDirection, getMarketStructureFromDirections } from "./confidence";
import { calculateRealConfidence } from "./optionChainConfidence";

export const OPTION_INDEXES = [
  { value: "NSE:NIFTY50-INDEX", label: "NIFTY", lot: 25 },
  { value: "NSE:NIFTYBANK-INDEX", label: "BANKNIFTY", lot: 15 },
  { value: "NSE:FINNIFTY-INDEX", label: "FINNIFTY", lot: 40 },
  { value: "NSE:MIDCPNIFTY-INDEX", label: "MIDCPNIFTY", lot: 50 },
  { value: "BSE:SENSEX-INDEX", label: "SENSEX", lot: 10 },
];

type SnapshotInput = {
  data: any;
  rows: any[];
  spot: number;
  timeToExpiryYears: number;
};

function calculateMaxPain(rows: any[]) {
  if (!rows.length) return null;
  let bestStrike = null;
  let minPain = Number.MAX_SAFE_INTEGER;
  for (const test of rows) {
    let pain = 0;
    for (const r of rows) {
      const ceOI = r.ce?.oi ?? 0;
      const peOI = r.pe?.oi ?? 0;
      if (r.strike < test.strike) pain += (test.strike - r.strike) * ceOI;
      if (r.strike > test.strike) pain += (r.strike - test.strike) * peOI;
    }
    if (pain < minPain) {
      minPain = pain;
      bestStrike = test.strike;
    }
  }
  return bestStrike;
}

function averageIv(rows: any[]) {
  let sumIV = 0;
  let count = 0;
  rows.forEach((r) => {
    if (r.ce?.iv) { sumIV += r.ce.iv; count++; }
    if (r.pe?.iv) { sumIV += r.pe.iv; count++; }
  });
  return count > 0 ? sumIV / count : 25;
}

function collectIvHistory(rows: any[]) {
  const history: number[] = [];
  rows.forEach((r) => {
    if (r.ce?.iv) history.push(r.ce.iv);
    if (r.pe?.iv) history.push(r.pe.iv);
  });
  return history;
}

function confidenceFor(input: SnapshotInput, side: "CE" | "PE", strike: number, totals: any, iv: any) {
  return calculateRealConfidence({
    rows: input.rows,
    strike,
    side,
    spot: input.spot,
    vwap: totals.vwap,
    ema20: totals.ema20,
    ema50: totals.ema50,
    data: input.data,
    timeToExpiryYears: input.timeToExpiryYears,
    avgIV: iv.avgIV,
    ivHistory: iv.ivHistory,
    totalCeOI: totals.totalCeOI,
    totalPeOI: totals.totalPeOI,
  });
}

export function buildOptionChainSnapshot(input: SnapshotInput) {
  const { data, rows, spot } = input;
  const vwap = data.vwap ?? null;
  const ema20 = data.ema20 ?? null;
  const ema50 = data.ema50 ?? null;

  const atmStrike = (() => {
    const step = Number(data.step ?? 50) || 50;
    if (!spot || rows.length === 0) return data.atm ?? null;
    const nearest = Math.round(spot / step) * step;
    const exactRow = rows.find((r) => r.strike === nearest);
    if (exactRow) return exactRow.strike;
    const closest = rows.reduce((best, current) =>
      Math.abs(current.strike - spot) < Math.abs(best.strike - spot) ? current : best,
      rows[0]
    );
    return closest?.strike ?? data.atm ?? null;
  })();

  const effectiveAtm = atmStrike ?? data.atm ?? null;
  const totalCeOI = rows.reduce((sum, r) => sum + (r.ce?.oi ?? 0), 0);
  const totalPeOI = rows.reduce((sum, r) => sum + (r.pe?.oi ?? 0), 0);
  const pcr = totalPeOI / (totalCeOI || 1);

  const resistanceRows = [...rows]
    .filter((r) => r.ce?.oi)
    .sort((a, b) => ((b.ce?.oi ?? 0) + (b.ce?.oi_change ?? 0)) - ((a.ce?.oi ?? 0) + (a.ce?.oi_change ?? 0)));

  const supportRows = [...rows]
    .filter((r) => r.pe?.oi)
    .sort((a, b) => ((b.pe?.oi ?? 0) + (b.pe?.oi_change ?? 0)) - ((a.pe?.oi ?? 0) + (a.pe?.oi_change ?? 0)));

  const r1 = resistanceRows[0]?.strike;
  const r2 = resistanceRows[1]?.strike;
  const s1 = supportRows[0]?.strike;
  const s2 = supportRows[1]?.strike;
  const topCe = resistanceRows[0];
  const topPe = supportRows[0];

  const s1Strength = totalPeOI ? Math.round(((supportRows[0]?.pe?.oi ?? 0) / totalPeOI) * 100) : 0;
  const s2Strength = totalPeOI ? Math.round(((supportRows[1]?.pe?.oi ?? 0) / totalPeOI) * 100) : 0;
  const r1Strength = totalCeOI ? Math.round(((resistanceRows[0]?.ce?.oi ?? 0) / totalCeOI) * 100) : 0;
  const r2Strength = totalCeOI ? Math.round(((resistanceRows[1]?.ce?.oi ?? 0) / totalCeOI) * 100) : 0;

  const ceWriter = topCe?.ce?.oi_change > 0 && topCe?.ce?.ltp < topCe?.ce?.ask;
  const peWriter = topPe?.pe?.oi_change > 0 && topPe?.pe?.ltp < topPe?.pe?.ask;
  const breakout = spot > (r1 ?? 0) ? "BREAKOUT" : spot < (s1 ?? 0) ? "BREAKDOWN" : "RANGE";

  const dir5 = calculateTrendDirection(vwap, ema20, ema50);
  const dir15 = calculateTrendDirection(data.vwap15 ?? null, data.ema2015 ?? null, data.ema5015 ?? null);
  const dir60 = calculateTrendDirection(data.vwap60 ?? null, data.ema2060 ?? null, data.ema5060 ?? null);
  const marketStructureOverall = getMarketStructureFromDirections(dir5, dir15, dir60);

  const avgIV = averageIv(rows);
  const ivHistory = collectIvHistory(rows);
  const totals = { totalCeOI, totalPeOI, vwap, ema20, ema50 };
  const iv = { avgIV, ivHistory };

  const confidenceMap: Record<string, any> = {};
  rows.forEach((r) => {
    if (r.ce) confidenceMap[`CE_${r.strike}`] = confidenceFor(input, "CE", r.strike, totals, iv);
    if (r.pe) confidenceMap[`PE_${r.strike}`] = confidenceFor(input, "PE", r.strike, totals, iv);
  });

  const atmCeConfidence = effectiveAtm ? confidenceMap[`CE_${effectiveAtm}`] ?? null : null;
  const atmPeConfidence = effectiveAtm ? confidenceMap[`PE_${effectiveAtm}`] ?? null : null;

  const callTotalVolume = rows.reduce((sum, r) => sum + (r.ce?.volume ?? 0), 0);
  const putTotalVolume = rows.reduce((sum, r) => sum + (r.pe?.volume ?? 0), 0);

  const trendSignal = vwap && ema20 && ema50
    ? spot > vwap && ema20 > ema50 ? 1 : spot < vwap && ema20 < ema50 ? -1 : 0
    : 0;
  const pcrSignal = pcr >= 1.05 ? 1 : pcr <= 0.95 ? -1 : 0;
  const writerSignal = (() => {
    let score = 0;
    if ((topCe?.ce?.oi_change ?? 0) >= 2000) score -= 1;
    if ((topCe?.ce?.oi_change ?? 0) <= -2000) score += 1;
    if ((topPe?.pe?.oi_change ?? 0) >= 2000) score += 1;
    if ((topPe?.pe?.oi_change ?? 0) <= -2000) score -= 1;
    return score > 0 ? 1 : score < 0 ? -1 : 0;
  })();

  const breakoutSignal = breakout === "BREAKOUT" ? 1 : breakout === "BREAKDOWN" ? -1 : 0;
  const volumeSignal = callTotalVolume > putTotalVolume * 1.1 ? 1 : putTotalVolume > callTotalVolume * 1.1 ? -1 : 0;
  const vwapSignal = spot > (vwap || 0) ? 1 : spot < (vwap || 0) ? -1 : 0;
  const analysisDirection = data.analysis?.overall?.direction;
  const analysisSignal = analysisDirection === "BULLISH" ? 1 : analysisDirection === "BEARISH" ? -1 : 0;
  const marketScoreRaw = trendSignal * 2 + pcrSignal + writerSignal * 2 + breakoutSignal * 2 + volumeSignal + vwapSignal + analysisSignal * 2;
  const bias = marketScoreRaw > 0 ? "Bullish" : marketScoreRaw < 0 ? "Bearish" : "Neutral";
  const flowConfluence = Math.max(0, Math.min(100, Math.round((Math.abs(marketScoreRaw) / 10) * 100)));
  let confluenceScore = flowConfluence;

  const callCandidates = rows
    .filter((r) => r.ce)
    .filter((r) => effectiveAtm === null || r.strike >= effectiveAtm)
    .map((r) => ({
      row: r,
      option: r.ce,
      score: confidenceMap[`CE_${r.strike}`]?.score ?? 0,
      side: "CE" as const,
    }))
    .sort((a, b) => b.score - a.score);

  const putCandidates = rows
    .filter((r) => r.pe)
    .filter((r) => effectiveAtm === null || r.strike <= effectiveAtm)
    .map((r) => ({
      row: r,
      option: r.pe,
      score: confidenceMap[`PE_${r.strike}`]?.score ?? 0,
      side: "PE" as const,
    }))
    .sort((a, b) => b.score - a.score);

  const recommendedCall = callCandidates[0];
  const recommendedPut = putCandidates[0];
  const recommendedOption = bias === "Bearish"
    ? recommendedPut
    : bias === "Bullish"
      ? recommendedCall
      : undefined;
  const candidateConfidence = recommendedOption?.score ?? 0;
  const chartAnalysisScore = Number(data.analysis?.overall?.score ?? 0);
  if (recommendedOption) {
    confluenceScore = Math.round(
      flowConfluence * 0.45 + candidateConfidence * 0.35 + chartAnalysisScore * 0.20
    );
  }
  const recommendedEntryPrice = recommendedOption?.option?.ltp ?? recommendedOption?.option?.ask ?? 0;
  const recommendedSL = recommendedEntryPrice ? parseFloat((recommendedEntryPrice * 0.88).toFixed(2)) : 0;
  const recommendedT1 = recommendedEntryPrice ? parseFloat((recommendedEntryPrice * 1.12).toFixed(2)) : 0;
  const recommendedT2 = recommendedEntryPrice ? parseFloat((recommendedEntryPrice * 1.25).toFixed(2)) : 0;

  return {
    atmCeConfidence,
    atmPeConfidence,
    bias,
    breakout,
    ceWriter,
    confidenceMap,
    confluenceScore,
    confluenceBreakdown: {
      flow: flowConfluence,
      contract: candidateConfidence,
      chart: chartAnalysisScore,
    },
    effectiveAtm,
    ema20,
    ema50,
    marketStructureOverall,
    maxPain: calculateMaxPain(rows),
    pcr,
    peWriter,
    r1,
    r1Strength,
    r2,
    r2Strength,
    recommendedCall,
    recommendedEntryPrice,
    recommendedOption,
    recommendedPut,
    recommendedSL,
    recommendedT1,
    recommendedT2,
    s1,
    s1Strength,
    s2,
    s2Strength,
    totalCeOI,
    totalPeOI,
    vwap,
  };
}
