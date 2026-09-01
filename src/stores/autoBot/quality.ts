export type ScannerCandidate = {
  symbol?: string;
  side?: "BUY" | "SELL" | string;
  signal?: string;
  entry?: number;
  ltp?: number;
  sl?: number;
  t1?: number;
  t2?: number;
  confidence?: number;
  factors?: Record<string, number | undefined>;
};

export type QualityGateResult = {
  ok: boolean;
  message: string;
  entry: number;
  sl: number;
  t1: number;
  t2: number;
  rr1: number;
  rr2: number;
  factorCount: number;
};

const MIN_CONFLUENCE_FACTORS = 4;
const BULLISH_SIGNAL_WORDS = ["breakout volume", "price breakout", "range breakout", "vwap breakout", "buy", "gap up", "golden"];
const BEARISH_SIGNAL_WORDS = ["gap down", "death", "rejection"];

export function numberValue(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function signalDirection(signal: unknown) {
  const text = String(signal || "").toLowerCase();
  if (BULLISH_SIGNAL_WORDS.some((word) => text.includes(word))) return "BUY";
  if (BEARISH_SIGNAL_WORDS.some((word) => text.includes(word))) return "SELL";
  return null;
}

export function evaluateScannerQuality(
  candidate: ScannerCandidate,
  side: "BUY" | "SELL",
  minT1RewardRisk: number,
  minT2RewardRisk: number
): QualityGateResult {
  const entry = numberValue(candidate.entry || candidate.ltp);
  const sl = numberValue(candidate.sl);
  const t1 = numberValue(candidate.t1);
  const t2 = numberValue(candidate.t2);
  const factors = candidate.factors || {};
  const factorCount = Object.values(factors).filter((value) => numberValue(value) > 0).length;
  const signalSide = signalDirection(candidate.signal);

  const base = { entry, sl, t1, t2, rr1: 0, rr2: 0, factorCount };
  if (signalSide && signalSide !== side) {
    return {
      ...base,
      ok: false,
      message: `Quality gate blocked ${side}. Signal direction suggests ${signalSide}.`,
    };
  }

  if (factorCount < MIN_CONFLUENCE_FACTORS) {
    return {
      ...base,
      ok: false,
      message: `Quality gate blocked ${side}. Only ${factorCount}/${MIN_CONFLUENCE_FACTORS} scanner factors aligned.`,
    };
  }

  if (!entry || !sl || !t1 || !t2) {
    return { ...base, ok: false, message: "Quality gate skipped signal. Entry, SL, T1, or T2 is missing." };
  }

  const risk = side === "BUY" ? entry - sl : sl - entry;
  const rewardT1 = side === "BUY" ? t1 - entry : entry - t1;
  const rewardT2 = side === "BUY" ? t2 - entry : entry - t2;
  const rr1 = risk > 0 ? rewardT1 / risk : 0;
  const rr2 = risk > 0 ? rewardT2 / risk : 0;

  if (risk <= 0 || rewardT1 <= 0 || rewardT2 <= 0) {
    return {
      ...base,
      rr1,
      rr2,
      ok: false,
      message: `Quality gate blocked ${side}. SL/targets do not match trade direction.`,
    };
  }

  if (rr1 < minT1RewardRisk) {
    return {
      ...base,
      rr1,
      rr2,
      ok: false,
      message: `Quality gate blocked ${side}. T1 R:R ${rr1.toFixed(2)} is below ${minT1RewardRisk.toFixed(2)}.`,
    };
  }

  if (rr2 < minT2RewardRisk) {
    return {
      ...base,
      rr1,
      rr2,
      ok: false,
      message: `Quality gate blocked ${side}. T2 R:R ${rr2.toFixed(2)} is below ${minT2RewardRisk.toFixed(2)}.`,
    };
  }

  return {
    ...base,
    rr1,
    rr2,
    ok: true,
    message: `Quality gate passed. T1 ${rr1.toFixed(2)}R, T2 ${rr2.toFixed(2)}R, ${factorCount} factors aligned.`,
  };
}
