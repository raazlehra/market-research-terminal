export type ChartRuleInput = {
  side?: "CE" | "PE" | string;
  spot?: number | null;
  vwap?: number | null;
  ema20?: number | null;
  ema50?: number | null;
  vwap15?: number | null;
  ema2015?: number | null;
  ema5015?: number | null;
  vwap60?: number | null;
  ema2060?: number | null;
  ema5060?: number | null;
  support?: number | null;
  resistance?: number | null;
  rsi5?: number | null;
  rsi15?: number | null;
  rsi60?: number | null;
  candleDirection?: "bullish" | "bearish" | "neutral" | string;
  candleConfirmed?: boolean;
  analysisFresh?: boolean;
  timeframesAvailable?: number;
};

export type ChartRuleResult = {
  score: number;
  tradeable: boolean;
  label: string;
  tone: "good" | "warn" | "bad";
  reasons: string[];
};

function numberValue(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function pctDistance(from: number, to: number) {
  return ((to - from) / from) * 100;
}

export function evaluateChartRules(input: ChartRuleInput): ChartRuleResult {
  const side = input.side === "PE" ? "PE" : "CE";
  const spot = numberValue(input.spot);
  const vwap = numberValue(input.vwap);
  const ema20 = numberValue(input.ema20);
  const ema50 = numberValue(input.ema50);
  const vwap15 = numberValue(input.vwap15);
  const ema2015 = numberValue(input.ema2015);
  const ema5015 = numberValue(input.ema5015);
  const vwap60 = numberValue(input.vwap60);
  const ema2060 = numberValue(input.ema2060);
  const ema5060 = numberValue(input.ema5060);
  const support = numberValue(input.support);
  const resistance = numberValue(input.resistance);
  const rsi5 = numberValue(input.rsi5);
  const rsi15 = numberValue(input.rsi15);
  const rsi60 = numberValue(input.rsi60);

  const reasons: string[] = [];
  let score = 100;
  let tradeable = true;

  if (input.analysisFresh === false) {
    score -= 35;
    tradeable = false;
    reasons.push("Underlying chart analysis is stale.");
  }

  if (input.timeframesAvailable !== undefined && input.timeframesAvailable < 2) {
    score -= 25;
    tradeable = false;
    reasons.push("Fewer than two chart timeframes are available.");
  }

  if (!spot || !vwap || !ema20 || !ema50) {
    return {
      score: 35,
      tradeable: false,
      label: "Chart unavailable",
      tone: "bad",
      reasons: ["VWAP/EMA chart confirmation is unavailable."],
    };
  }

  const primaryBullish = spot > vwap && ema20 >= ema50 && spot >= ema20;
  const primaryBearish = spot < vwap && ema20 <= ema50 && spot <= ema20;

  if (side === "CE") {
    if (!primaryBullish) {
      score -= 45;
      tradeable = false;
      reasons.push("CE blocked: spot is not above VWAP with bullish EMA alignment.");
    } else {
      reasons.push("CE chart trend confirms above VWAP/EMA.");
    }

    if (resistance && resistance > spot) {
      const room = pctDistance(spot, resistance);
      if (room < 0.15) {
        score -= 20;
        tradeable = false;
        reasons.push(`CE blocked: resistance is too close (${room.toFixed(2)}%).`);
      } else {
        reasons.push(`CE has ${room.toFixed(2)}% room to resistance.`);
      }
    }
  } else {
    if (!primaryBearish) {
      score -= 45;
      tradeable = false;
      reasons.push("PE blocked: spot is not below VWAP with bearish EMA alignment.");
    } else {
      reasons.push("PE chart trend confirms below VWAP/EMA.");
    }

    if (support && support < spot) {
      const room = Math.abs(pctDistance(spot, support));
      if (room < 0.15) {
        score -= 20;
        tradeable = false;
        reasons.push(`PE blocked: support is too close (${room.toFixed(2)}%).`);
      } else {
        reasons.push(`PE has ${room.toFixed(2)}% room to support.`);
      }
    }
  }

  if (vwap15 && ema2015 && ema5015) {
    const confirms15 = side === "CE"
      ? spot > vwap15 && ema2015 >= ema5015
      : spot < vwap15 && ema2015 <= ema5015;
    if (!confirms15) {
      score -= 15;
      reasons.push("15m trend does not fully confirm.");
    } else {
      reasons.push("15m trend confirms.");
    }
  }

  if (vwap60 && ema2060 && ema5060) {
    const against60 = side === "CE"
      ? spot < vwap60 && ema2060 < ema5060
      : spot > vwap60 && ema2060 > ema5060;
    if (against60) {
      score -= 15;
      reasons.push("1h trend is against the trade.");
    }
  }

  if (rsi5) {
    const ideal = side === "CE" ? rsi5 >= 50 && rsi5 <= 70 : rsi5 >= 30 && rsi5 <= 50;
    const extended = side === "CE" ? rsi5 > 75 : rsi5 < 25;
    if (ideal) reasons.push(`RSI ${rsi5.toFixed(1)} supports ${side}.`);
    else if (extended) {
      score -= 15;
      reasons.push(`RSI ${rsi5.toFixed(1)} is extended; avoid chasing ${side}.`);
    } else {
      score -= 7;
      reasons.push(`RSI ${rsi5.toFixed(1)} is not in the ideal ${side} zone.`);
    }
  }

  const higherRsiValues = [rsi15, rsi60].filter((value): value is number => value !== null);
  if (higherRsiValues.length) {
    const confirming = higherRsiValues.filter((value) => side === "CE" ? value >= 45 : value <= 55).length;
    if (confirming === higherRsiValues.length) {
      reasons.push(`${higherRsiValues.length} higher-timeframe RSI reading(s) confirm ${side}.`);
    } else {
      score -= confirming === 0 ? 12 : 6;
      reasons.push("Higher-timeframe RSI is not fully aligned.");
    }
  }

  if (input.candleConfirmed) {
    const matches = side === "CE" ? input.candleDirection === "bullish" : input.candleDirection === "bearish";
    if (matches) reasons.push("Latest completed candle confirms the direction.");
    else {
      score -= 25;
      tradeable = false;
      reasons.push("Latest confirmed candle opposes the trade direction.");
    }
  } else {
    score -= 8;
    reasons.push("No strong completed-candle confirmation.");
  }

  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const tone = !tradeable || boundedScore < 50 ? "bad" : boundedScore < 75 ? "warn" : "good";
  const label = side === "CE" ? "CE chart confirmation" : "PE chart confirmation";

  return { score: boundedScore, tradeable, label, tone, reasons };
}
