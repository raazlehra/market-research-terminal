export type CandleDirection = "bullish" | "bearish" | "neutral";

export type CandleInput = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  ts?: number;
  label?: string;
};

export type CandlestickSignal = {
  name: string;
  direction: CandleDirection;
  type: "reversal" | "continuation" | "momentum" | "none";
  score: number;
  entry: number | null;
  sl: number | null;
  confirmed: boolean;
  reason: string;
  targetHint: string;
};

const NO_SIGNAL: CandlestickSignal = {
  name: "No clear candle pattern",
  direction: "neutral",
  type: "none",
  score: 0,
  entry: null,
  sl: null,
  confirmed: false,
  reason: "No high-probability candle pattern on the latest candles.",
  targetHint: "Use normal trend, support, resistance, and risk rules.",
};

function n(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizePatternCandle(value: unknown): CandleInput | null {
  if (Array.isArray(value)) {
    const open = n(value[1]);
    const high = n(value[2]);
    const low = n(value[3]);
    const close = n(value[4]);
    if (open === null || high === null || low === null || close === null) return null;
    return { ts: n(value[0]) ?? undefined, open, high, low, close, volume: n(value[5]) ?? 0 };
  }

  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const open = n(row.open ?? row.o);
  const high = n(row.high ?? row.h);
  const low = n(row.low ?? row.l);
  const close = n(row.close ?? row.c ?? row.price);
  if (open === null || high === null || low === null || close === null) return null;
  return {
    ts: n(row.ts ?? row.time ?? row.timestamp) ?? undefined,
    open,
    high,
    low,
    close,
    volume: n(row.volume ?? row.v) ?? 0,
    label: typeof row.label === "string" ? row.label : undefined,
  };
}

export function candlesFromHistoryPayload(payload: unknown): CandleInput[] {
  const row = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const raw = Array.isArray(row.candles)
    ? row.candles
    : row.data && typeof row.data === "object" && Array.isArray((row.data as Record<string, unknown>).candles)
      ? (row.data as Record<string, unknown>).candles as unknown[]
      : [];
  return raw.map(normalizePatternCandle).filter((c): c is CandleInput => Boolean(c));
}

function range(c: CandleInput) {
  return Math.max(c.high - c.low, 0.01);
}

function body(c: CandleInput) {
  return Math.abs(c.close - c.open);
}

function upperWick(c: CandleInput) {
  return c.high - Math.max(c.open, c.close);
}

function lowerWick(c: CandleInput) {
  return Math.min(c.open, c.close) - c.low;
}

function isBull(c: CandleInput) {
  return c.close > c.open;
}

function isBear(c: CandleInput) {
  return c.close < c.open;
}

function bodyPct(c: CandleInput) {
  return body(c) / range(c);
}

function midpoint(c: CandleInput) {
  return (c.open + c.close) / 2;
}

function avgVolume(candles: CandleInput[]) {
  const values = candles.map((c) => Number(c.volume || 0)).filter((v) => v > 0);
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function volumeConfirmed(candles: CandleInput[], candle: CandleInput) {
  const avg = avgVolume(candles.slice(-12, -1));
  return avg <= 0 || Number(candle.volume || 0) >= avg * 1.15;
}

function priorTrend(candles: CandleInput[]) {
  const lookback = candles.slice(-8, -2);
  if (lookback.length < 3) return "neutral" as CandleDirection;
  const first = lookback[0].close;
  const last = lookback[lookback.length - 1].close;
  const move = ((last - first) / first) * 100;
  if (move > 0.25) return "bullish";
  if (move < -0.25) return "bearish";
  return "neutral";
}

function makeSignal(partial: Omit<CandlestickSignal, "score"> & { score?: number }, candles: CandleInput[]): CandlestickSignal {
  const volumeBonus = volumeConfirmed(candles, candles[candles.length - 1]) ? 8 : 0;
  return {
    ...partial,
    score: Math.max(0, Math.min(100, Math.round((partial.score ?? 70) + volumeBonus))),
  };
}

export function evaluateCandlestickPattern(candles: CandleInput[]): CandlestickSignal {
  const rows = candles.filter((c) => c.high >= c.low && c.open > 0 && c.close > 0);
  if (rows.length < 3) return NO_SIGNAL;

  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const p2 = rows[rows.length - 3];
  const p3 = rows[rows.length - 4];
  const p4 = rows[rows.length - 5];
  const trend = priorTrend(rows);

  const prevHammerShape = lowerWick(prev) >= body(prev) * 2 && upperWick(prev) <= body(prev) * 1.2 && bodyPct(prev) <= 0.45;
  if (trend === "bearish" && prevHammerShape && isBull(last) && last.close > prev.high) {
    return makeSignal({
      name: "Hammer confirmed",
      direction: "bullish",
      type: "reversal",
      entry: prev.high,
      sl: prev.low,
      confirmed: true,
      reason: "Hammer after downtrend confirmed by green close above hammer high.",
      targetHint: "T1 nearest resistance, T2 around 2R, trail with 9EMA.",
      score: 84,
    }, rows);
  }

  const prevInvertedHammer = upperWick(prev) >= body(prev) * 2 && lowerWick(prev) <= body(prev) * 1.2 && bodyPct(prev) <= 0.45;
  if (trend === "bearish" && prevInvertedHammer && isBull(last) && last.close > prev.high) {
    return makeSignal({
      name: "Inverted Hammer confirmed",
      direction: "bullish",
      type: "reversal",
      entry: prev.high,
      sl: prev.low,
      confirmed: true,
      reason: "Inverted hammer after downtrend confirmed by next green candle.",
      targetHint: "Use resistance first, then 2R if momentum holds.",
      score: 78,
    }, rows);
  }

  if (isBear(prev) && isBull(last) && last.open <= prev.close && last.close >= prev.open && body(last) > body(prev) * 1.05) {
    return makeSignal({
      name: "Bullish Engulfing",
      direction: "bullish",
      type: "reversal",
      entry: last.high,
      sl: Math.min(prev.low, last.low),
      confirmed: volumeConfirmed(rows, last),
      reason: "Bullish candle engulfed the prior bearish body.",
      targetHint: "Prefer 1.5R-2R, or trail below prior candle lows.",
      score: 82,
    }, rows);
  }

  if (isBear(p2) && bodyPct(prev) <= 0.35 && isBull(last) && last.close > midpoint(p2)) {
    return makeSignal({
      name: "Morning Star",
      direction: "bullish",
      type: "reversal",
      entry: last.high,
      sl: Math.min(p2.low, prev.low, last.low),
      confirmed: true,
      reason: "Three-candle bullish reversal with recovery above first candle midpoint.",
      targetHint: "Minimum 2R; better on 15m-1h for F&O.",
      score: 86,
    }, rows);
  }

  if (isBull(p2) && isBull(prev) && isBull(last) && last.close > prev.close && prev.close > p2.close) {
    return makeSignal({
      name: "Three White Soldiers",
      direction: "bullish",
      type: "momentum",
      entry: last.high,
      sl: prev.low,
      confirmed: true,
      reason: "Three rising bullish candles show strong follow-through.",
      targetHint: "Trail with 20EMA or previous candle low.",
      score: 80,
    }, rows);
  }

  if (isBull(last) && bodyPct(last) >= 0.75 && last.close >= last.high - range(last) * 0.12) {
    return makeSignal({
      name: "Bullish Marubozu",
      direction: "bullish",
      type: "momentum",
      entry: last.high,
      sl: last.low,
      confirmed: volumeConfirmed(rows, last),
      reason: "Strong full-body bullish breakout candle.",
      targetHint: "Use 2R or prior day high; wait retest if gap-up.",
      score: 76,
    }, rows);
  }

  if (isBear(prev) && isBull(last) && last.open < prev.low && last.close > midpoint(prev) && last.close < prev.open) {
    return makeSignal({
      name: "Piercing Line",
      direction: "bullish",
      type: "reversal",
      entry: last.high,
      sl: Math.min(prev.low, last.low),
      confirmed: true,
      reason: "Bullish recovery pierced above prior bearish midpoint.",
      targetHint: "Target prior swing high.",
      score: 72,
    }, rows);
  }

  if (p4 && isBull(p4) && isBear(p3) && isBear(p2) && isBear(prev) && last.close > p4.high && last.low > p4.low) {
    return makeSignal({
      name: "Rising Three Methods",
      direction: "bullish",
      type: "continuation",
      entry: p4.high,
      sl: Math.min(p3.low, p2.low, prev.low),
      confirmed: true,
      reason: "Bullish continuation broke above the first candle high.",
      targetHint: "Continue trend with trailing SL.",
      score: 78,
    }, rows);
  }

  const prevShootingStar = upperWick(prev) >= body(prev) * 2 && lowerWick(prev) <= body(prev) * 1.2 && bodyPct(prev) <= 0.45;
  if (trend === "bullish" && prevShootingStar && isBear(last) && last.close < prev.low) {
    return makeSignal({
      name: "Shooting Star confirmed",
      direction: "bearish",
      type: "reversal",
      entry: prev.low,
      sl: prev.high,
      confirmed: true,
      reason: "Shooting star after uptrend confirmed by bearish close below low.",
      targetHint: "T1 nearest support, then 1.5R-2R.",
      score: 84,
    }, rows);
  }

  if (isBull(prev) && isBear(last) && last.open >= prev.close && last.close <= prev.open && body(last) > body(prev) * 1.05) {
    return makeSignal({
      name: "Bearish Engulfing",
      direction: "bearish",
      type: "reversal",
      entry: last.low,
      sl: Math.max(prev.high, last.high),
      confirmed: volumeConfirmed(rows, last),
      reason: "Bearish candle engulfed the prior bullish body.",
      targetHint: "Use support or 2R target.",
      score: 82,
    }, rows);
  }

  if (isBull(p2) && bodyPct(prev) <= 0.35 && isBear(last) && last.close < midpoint(p2)) {
    return makeSignal({
      name: "Evening Star",
      direction: "bearish",
      type: "reversal",
      entry: last.low,
      sl: Math.max(p2.high, prev.high, last.high),
      confirmed: true,
      reason: "Three-candle bearish reversal with close below first candle midpoint.",
      targetHint: "Prior swing low, then 2R-3R if trend expands.",
      score: 86,
    }, rows);
  }

  if (isBear(p2) && isBear(prev) && isBear(last) && last.close < prev.close && prev.close < p2.close) {
    return makeSignal({
      name: "Three Black Crows",
      direction: "bearish",
      type: "momentum",
      entry: last.low,
      sl: prev.high,
      confirmed: true,
      reason: "Three falling bearish candles show strong downside follow-through.",
      targetHint: "Trail until reversal or bounce above 20EMA.",
      score: 80,
    }, rows);
  }

  if (isBear(last) && bodyPct(last) >= 0.75 && last.close <= last.low + range(last) * 0.12) {
    return makeSignal({
      name: "Bearish Marubozu",
      direction: "bearish",
      type: "momentum",
      entry: last.low,
      sl: last.high,
      confirmed: volumeConfirmed(rows, last),
      reason: "Strong full-body bearish breakdown candle.",
      targetHint: "Use 2R or prior day low; wait retest if gap-down.",
      score: 76,
    }, rows);
  }

  if (isBull(prev) && isBear(last) && last.open > prev.high && last.close < midpoint(prev) && last.close > prev.open) {
    return makeSignal({
      name: "Dark Cloud Cover",
      direction: "bearish",
      type: "reversal",
      entry: last.low,
      sl: Math.max(prev.high, last.high),
      confirmed: true,
      reason: "Bearish reversal closed below prior bullish midpoint.",
      targetHint: "Target support or 1.5R.",
      score: 72,
    }, rows);
  }

  if (p4 && isBear(p4) && isBull(p3) && isBull(p2) && isBull(prev) && last.close < p4.low && last.high < p4.high) {
    return makeSignal({
      name: "Falling Three Methods",
      direction: "bearish",
      type: "continuation",
      entry: p4.low,
      sl: Math.max(p3.high, p2.high, prev.high),
      confirmed: true,
      reason: "Bearish continuation broke below the first candle low.",
      targetHint: "Continue downtrend with trailing SL.",
      score: 78,
    }, rows);
  }

  return NO_SIGNAL;
}

export function optionSideMatchesPattern(optionSide: "CE" | "PE" | "BUY" | "SELL", signal: CandlestickSignal) {
  if (signal.direction === "neutral") return true;
  if (optionSide === "CE" || optionSide === "BUY") return signal.direction === "bullish";
  return signal.direction === "bearish";
}

export function patternBlocksSide(optionSide: "CE" | "PE" | "BUY" | "SELL", signal: CandlestickSignal) {
  return signal.direction !== "neutral" && signal.score >= 72 && !optionSideMatchesPattern(optionSide, signal);
}
