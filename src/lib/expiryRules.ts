export type ExpiryRuleInput = {
  expiry?: string | number | null;
  expiryLabel?: string | null;
  bid?: number;
  ask?: number;
  ltp?: number;
  volume?: number;
  oi?: number;
  confidence?: number;
  side?: "CE" | "PE" | string;
  bias?: string;
};

export type ExpiryRuleResult = {
  dte: number | null;
  score: number;
  tradeable: boolean;
  label: string;
  tone: "good" | "warn" | "bad";
  reasons: string[];
};

function toNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function parseExpiryDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const numeric = Number(value);
    const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = String(value).trim();
  const ddmmyyyy = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    return new Date(`${yyyy}-${mm}-${dd}T15:30:00+05:30`);
  }

  const yyyymmdd = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (yyyymmdd) return new Date(`${text}T15:30:00+05:30`);

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function daysToExpiry(value: unknown, now = new Date()) {
  const expiry = parseExpiryDate(value);
  if (!expiry) return null;
  return (expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
}

export function evaluateExpiryRules(input: ExpiryRuleInput, now = new Date()): ExpiryRuleResult {
  const dte = daysToExpiry(input.expiryLabel || input.expiry, now);
  const bid = toNumber(input.bid);
  const ask = toNumber(input.ask);
  const ltp = toNumber(input.ltp);
  const volume = toNumber(input.volume);
  const oi = toNumber(input.oi);
  const confidence = toNumber(input.confidence);
  const reasons: string[] = [];
  let score = 100;
  let tradeable = true;

  if (dte === null) {
    score -= 20;
    reasons.push("Expiry date unavailable.");
  } else if (dte < 0) {
    score = 0;
    tradeable = false;
    reasons.push("Expiry is already over.");
  } else if (dte < 1) {
    score -= 45;
    tradeable = false;
    reasons.push("Same-day expiry is blocked for Auto-Bot buys.");
  } else if (dte <= 3) {
    score -= 12;
    reasons.push("Near expiry: faster theta decay, only scalp quality.");
  } else if (dte <= 10) {
    reasons.push("Weekly sweet spot for directional option buys.");
  } else if (dte <= 30) {
    score -= 8;
    reasons.push("Next expiry: safer theta, slower movement.");
  } else {
    score -= 25;
    reasons.push("Far expiry is less efficient for intraday Auto-Bot.");
  }

  const reference = ltp || ask || bid;
  const spreadPct = reference > 0 && ask > 0 && bid > 0 ? ((ask - bid) / reference) * 100 : null;
  if (spreadPct === null) {
    score -= 20;
    reasons.push("Bid/ask spread unavailable.");
  } else if (spreadPct > 8) {
    score -= 35;
    tradeable = false;
    reasons.push(`Spread too wide (${spreadPct.toFixed(1)}%).`);
  } else if (spreadPct > 4) {
    score -= 12;
    reasons.push(`Spread is moderate (${spreadPct.toFixed(1)}%).`);
  } else {
    reasons.push(`Spread is acceptable (${spreadPct.toFixed(1)}%).`);
  }

  if (oi < 1000 && volume < 100) {
    score -= 25;
    tradeable = false;
    reasons.push("Liquidity too low for Auto-Bot.");
  } else if (oi < 5000 && volume < 500) {
    score -= 10;
    reasons.push("Liquidity is thin.");
  } else {
    reasons.push("Liquidity looks usable.");
  }

  if (confidence < 60) {
    score -= 10;
    reasons.push("Confluence is below ideal option-buy zone.");
  }

  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const label = dte === null
    ? "Expiry unknown"
    : dte < 1
      ? "0DTE / same day"
      : dte <= 3
        ? "Near expiry"
        : dte <= 10
          ? "Weekly sweet spot"
          : dte <= 30
            ? "Next expiry"
            : "Far expiry";

  const tone = !tradeable || boundedScore < 45 ? "bad" : boundedScore < 70 ? "warn" : "good";
  return { dte, score: boundedScore, tradeable, label, tone, reasons };
}
