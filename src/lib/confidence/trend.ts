export function calculateTrendAlignment(
  spot: number,
  vwap: number | null,
  ema20: number | null,
  ema50: number | null,
  isCall: boolean
): number {
  let score = 0;

  if (!vwap || !ema20 || !ema50) return 0;

  const bullish = spot > vwap && ema20 > ema50 && spot > ema20;
  const bearish = spot < vwap && ema20 < ema50 && spot < ema20;

  // Perfect alignment: +15 (was 25)
  if (bullish && isCall) score += 15;
  if (bearish && !isCall) score += 15;

  // Partial alignment
  if (spot > vwap && isCall) score += 8;
  if (spot < vwap && !isCall) score += 8;

  if (ema20 > ema50 && isCall) score += 5;
  if (ema20 < ema50 && !isCall) score += 5;

  if (spot > ema50 && isCall) score += 3;
  if (spot < ema50 && !isCall) score += 3;

  return Math.min(score, 15);
}

export function calculateTrendDirection(
  vwap: number | null,
  ema20: number | null,
  ema50: number | null
): number {
  if (!vwap || !ema20 || !ema50) return 0;

  const bullish = ema20 > ema50 && vwap > ema20;
  const bearish = ema20 < ema50 && vwap < ema20;

  if (bullish) return 1;
  if (bearish) return -1;
  return 0;
}

export function getMarketStructureFromDirections(
  dir5: number,
  dir15: number,
  dir60: number
): "Bullish" | "Bearish" | "Neutral" {
  const sum = (dir5 || 0) + (dir15 || 0) + (dir60 || 0);
  if (sum >= 2) return "Bullish";
  if (sum <= -2) return "Bearish";
  return "Neutral";
}

export function calculateTrendConfluence(
  direction5: number,
  direction15: number,
  direction60: number
): number {
  let score = 0;

  if (direction5 !== 0 && direction5 === direction15) score += 4;
  if (direction15 !== 0 && direction15 === direction60) score += 4;

  return Math.min(score, 8);
}
