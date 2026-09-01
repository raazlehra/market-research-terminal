export type OptionLiquidityInput = {
  bid?: number;
  ask?: number;
  ltp?: number;
  volume?: number;
  oi?: number;
};

export type OptionLiquidityResult = {
  tradeable: boolean;
  score: number;
  tone: "good" | "warn" | "bad";
  label: string;
  spreadPct: number | null;
  reasons: string[];
};

function toNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function evaluateOptionLiquidity(input: OptionLiquidityInput): OptionLiquidityResult {
  const bid = toNumber(input.bid);
  const ask = toNumber(input.ask);
  const ltp = toNumber(input.ltp);
  const volume = toNumber(input.volume);
  const oi = toNumber(input.oi);
  const reference = ltp || ask || bid;
  const spreadPct = reference > 0 && ask > 0 && bid > 0 && ask >= bid
    ? ((ask - bid) / reference) * 100
    : null;
  const reasons: string[] = [];
  let score = 100;
  let tradeable = true;

  if (spreadPct === null) {
    score -= 45;
    tradeable = false;
    reasons.push("Bid/ask spread unavailable.");
  } else if (spreadPct > 5) {
    score -= 45;
    tradeable = false;
    reasons.push(`Spread too wide (${spreadPct.toFixed(1)}%).`);
  } else if (spreadPct > 3) {
    score -= 18;
    reasons.push(`Spread is slightly wide (${spreadPct.toFixed(1)}%).`);
  } else {
    reasons.push(`Spread is tight (${spreadPct.toFixed(1)}%).`);
  }

  if (oi < 2000 && volume < 200) {
    score -= 35;
    tradeable = false;
    reasons.push("OI and volume are too low.");
  } else if (oi < 5000 && volume < 500) {
    score -= 15;
    reasons.push("Liquidity is thin.");
  } else {
    reasons.push("Liquidity is usable.");
  }

  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const tone = !tradeable || boundedScore < 50 ? "bad" : boundedScore < 75 ? "warn" : "good";
  const label = !tradeable ? "Poor liquidity" : tone === "warn" ? "Usable liquidity" : "Good liquidity";
  return { tradeable, score: boundedScore, tone, label, spreadPct, reasons };
}
