export function calculateGreeksFavor(
  delta: number,
  _gamma: number,
  _theta: number,
  _isCall: boolean
): number {
  let score = 0;

  // Delta positioning (0-10)
  // For calls: delta 0.4-0.7 is optimal (good upside exposure, not too risky)
  // For puts: delta -0.7 to -0.4 is optimal
  const absDelta = Math.abs(delta);

  if (absDelta >= 0.4 && absDelta <= 0.7) score += 10;
  else if (absDelta >= 0.3 && absDelta <= 0.8) score += 7;
  else if (absDelta >= 0.2 && absDelta <= 0.9) score += 4;

  return Math.min(score, 10);
}

export function calculateIVExtreme(
  currentIV: number,
  avgIV: number,
  ivPercentile: number
): number {
  let score = 0;

  // IV Percentile (0-10)
  // Percentile 0-20 = Low IV (good for buying), 80-100 = High IV (risky)
  if (ivPercentile < 30) score += 10;
  else if (ivPercentile < 50) score += 7;
  else if (ivPercentile < 70) score += 4;
  else if (ivPercentile > 80) score -= 5; // High IV penalty

  // IV vs Average (0-5)
  if (avgIV > 0) {
    const ivRatio = currentIV / avgIV;
    if (ivRatio < 0.8) score += 5;
    else if (ivRatio < 1.0) score += 3;
    else if (ivRatio > 1.3) score -= 3;
  }

  return Math.max(0, Math.min(score, 15));
}

export function calculateVolumeCluster(
  volume: number,
  oi: number,
  avgVolume: number,
  oiChange: number,
  totalOI = 0
): number {
  let score = 0;

  // Volume surge against same-side chain baseline.
  const volumeRatio = avgVolume > 0 ? volume / avgVolume : 0;
  if (volumeRatio >= 2.5) score += 8;
  else if (volumeRatio >= 1.75) score += 6;
  else if (volumeRatio >= 1.25) score += 4;
  else if (volumeRatio >= 1) score += 2;

  // Positive OI change as a relative build-up, so index lot sizes do not skew scoring.
  const oiChangeRatio = oi > 0 ? oiChange / oi : 0;
  if (oiChangeRatio >= 0.12) score += 5;
  else if (oiChangeRatio >= 0.06) score += 4;
  else if (oiChangeRatio > 0) score += 2;

  // Meaningful strike concentration compared with the full side OI.
  const oiShare = totalOI > 0 ? oi / totalOI : 0;
  if (oiShare >= 0.1) score += 2;
  else if (oiShare >= 0.06) score += 1;

  return Math.min(score, 15);
}

export function calculateWriterPositioning(
  oiChange: number,
  otherSideOiChange: number,
  strikeBeforeSpot: boolean,
  oi = 0,
  otherSideOi = 0
): number {
  let score = 0;
  const oiChangeRatio = oi > 0 ? oiChange / oi : 0;
  const otherSideOiChangeRatio = otherSideOi > 0 ? otherSideOiChange / otherSideOi : 0;

  // Writers exiting (unwind = risk of gamma move)
  if (oiChangeRatio <= -0.12) score += 6; // Strong exit signal
  else if (oiChangeRatio <= -0.06) score += 4;
  else if (oiChangeRatio < 0) score += 1;

  // Trapped writers (positive OI but price against them)
  if (oiChangeRatio >= 0.08 && strikeBeforeSpot) score += 3; // Writers trapped

  // OI comparison (0-2)
  if (otherSideOiChangeRatio > oiChangeRatio + 0.06) score += 2; // Other side accumulating

  return Math.min(score, 8);
}

export function detectWriterEvent(
  oiChange: number,
  priceChangePct: number,
  isCall: boolean
): string | null {
  const strongOi = 3000;
  const moderateOi = 1000;
  const upPct = 0.5; // 0.5% price move threshold
  const downPct = -0.5;

  // Fresh writing: OI increasing strongly while price moves against the option direction
  if (oiChange >= strongOi) {
    if (isCall) {
      // Calls being written; price flat or down
      if (priceChangePct <= upPct) return "Fresh Call Writing";
    } else {
      // Puts being written; price flat or up
      if (priceChangePct >= downPct) return "Fresh Put Writing";
    }
  }

  // Moderate writing
  if (oiChange >= moderateOi) {
    if (isCall && priceChangePct <= 0.8) return "Call Writing (build)";
    if (!isCall && priceChangePct >= -0.8) return "Put Writing (build)";
  }

  // Unwinding / short covering (OI falling)
  if (oiChange <= -strongOi) {
    // If price rising while OI falls -> short covering
    if (priceChangePct > upPct) return "Short Covering";
    // If price falling while OI falls -> long unwinding
    if (priceChangePct < downPct) return "Long Unwinding";
    // If near-flat price, specify side-specific unwind
    return isCall ? "Call Unwinding" : "Put Unwinding";
  }

  if (oiChange <= -moderateOi) {
    if (priceChangePct > upPct) return "Short Covering";
    if (priceChangePct < downPct) return isCall ? "Call Unwinding" : "Put Unwinding";
  }

  return null;
}

export function calculateLiquidity(
  bid: number,
  ask: number,
  volume: number,
  oi: number,
  avgVolume: number
): number {
  let score = 0;
  const spread = bid > 0 && ask > bid ? (ask - bid) / ask : 1;

  // Spread: tighter spreads are more liquid
  if (spread <= 0.01) score += 5;
  else if (spread <= 0.015) score += 3;
  else if (spread <= 0.02) score += 1;

  // Volume: stronger volume supports better execution
  const volumeRatio = avgVolume > 0 ? volume / avgVolume : 0;
  if (volumeRatio >= 1) score += 3;
  else if (volumeRatio >= 0.7) score += 2;
  else if (volumeRatio >= 0.5) score += 1;

  // OI: contracts with meaningful open interest are more tradable
  if (oi >= 3000) score += 2;
  else if (oi >= 1500) score += 1;

  return Math.min(Math.max(score, 0), 10);
}
