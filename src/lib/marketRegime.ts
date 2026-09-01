import type { CandleInput } from "./candlestickPatterns";

export type MarketRegime = "TREND_UP" | "TREND_DOWN" | "RANGE" | "VOLATILE" | "LOW_VOLUME";

export type MarketRegimeSignal = {
  regime: MarketRegime;
  trendPct: number;
  rangePct: number;
  atrPct: number;
  volumeRatio: number | null;
  reason: string;
};

export type MarketRegimeDisplay = {
  label: string;
  tone: "emerald" | "rose" | "amber" | "indigo" | "slate";
  action: string;
};

export const MARKET_REGIME_DISPLAY: Record<MarketRegime, MarketRegimeDisplay> = {
  TREND_UP: {
    label: "Trend Up",
    tone: "emerald",
    action: "CE / long signals get cleaner follow-through.",
  },
  TREND_DOWN: {
    label: "Trend Down",
    tone: "rose",
    action: "PE / short signals get cleaner follow-through.",
  },
  RANGE: {
    label: "Range",
    tone: "slate",
    action: "Breakouts need confirmation; avoid weak option buys.",
  },
  VOLATILE: {
    label: "Volatile",
    tone: "amber",
    action: "Use smaller size and stricter SL checks.",
  },
  LOW_VOLUME: {
    label: "Low Volume",
    tone: "indigo",
    action: "Avoid chasing; wait for volume confirmation.",
  },
};

function avg(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function pct(value: number): number {
  return Math.round(value * 10000) / 100;
}

export function evaluateMarketRegime(candles: CandleInput[]): MarketRegimeSignal {
  const rows = candles
    .filter((candle) => candle.open > 0 && candle.high >= candle.low && candle.close > 0)
    .slice(-24);

  if (rows.length < 8) {
    return {
      regime: "RANGE",
      trendPct: 0,
      rangePct: 0,
      atrPct: 0,
      volumeRatio: null,
      reason: "Not enough candles; treating market as range.",
    };
  }

  const first = rows[0];
  const last = rows[rows.length - 1];
  const highs = rows.map((candle) => candle.high);
  const lows = rows.map((candle) => candle.low);
  const ranges = rows.map((candle) => candle.high - candle.low);
  const close = Math.max(last.close, 0.01);
  const trend = (last.close - first.close) / first.close;
  const sessionRange = (Math.max(...highs) - Math.min(...lows)) / close;
  const atr = avg(ranges) / close;
  const recentVolume = avg(rows.slice(-5).map((candle) => Number(candle.volume || 0)).filter((value) => value > 0));
  const baseVolume = avg(rows.slice(0, -5).map((candle) => Number(candle.volume || 0)).filter((value) => value > 0));
  const volumeRatio = baseVolume > 0 && recentVolume > 0 ? recentVolume / baseVolume : null;

  if (volumeRatio !== null && volumeRatio < 0.45) {
    return {
      regime: "LOW_VOLUME",
      trendPct: pct(trend),
      rangePct: pct(sessionRange),
      atrPct: pct(atr),
      volumeRatio,
      reason: "Recent volume is less than half of baseline volume.",
    };
  }

  if (atr > 0.012 || sessionRange > 0.035) {
    return {
      regime: "VOLATILE",
      trendPct: pct(trend),
      rangePct: pct(sessionRange),
      atrPct: pct(atr),
      volumeRatio,
      reason: "Large candle ranges or session range show volatile conditions.",
    };
  }

  if (trend > 0.006 && last.close > avg(rows.slice(-8).map((candle) => candle.close))) {
    return {
      regime: "TREND_UP",
      trendPct: pct(trend),
      rangePct: pct(sessionRange),
      atrPct: pct(atr),
      volumeRatio,
      reason: "Price is advancing and closing above recent average.",
    };
  }

  if (trend < -0.006 && last.close < avg(rows.slice(-8).map((candle) => candle.close))) {
    return {
      regime: "TREND_DOWN",
      trendPct: pct(trend),
      rangePct: pct(sessionRange),
      atrPct: pct(atr),
      volumeRatio,
      reason: "Price is declining and closing below recent average.",
    };
  }

  return {
    regime: "RANGE",
    trendPct: pct(trend),
    rangePct: pct(sessionRange),
    atrPct: pct(atr),
    volumeRatio,
    reason: "Trend is not strong enough; treating market as range.",
  };
}
