export const SYMBOLS = [
  "NSE:NIFTY50-INDEX",
  "NSE:NIFTYBANK-INDEX",
  "NSE:RELIANCE-EQ",
  "NSE:HDFCBANK-EQ",
  "NSE:INFY-EQ",
  "NSE:TCS-EQ",
];

export type RawCandle =
  | [number, number, number, number, number, number?]
  | {
      time?: number;
      timestamp?: number;
      ts?: number;
      open?: number;
      o?: number;
      high?: number;
      h?: number;
      low?: number;
      l?: number;
      close?: number;
      c?: number;
      price?: number;
      volume?: number;
      v?: number;
    };

export type ChartPoint = {
  ts: number;
  date: string;
  time: string;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  price: number;
  volume: number;
  live?: boolean;
};

export type ChartStudyPoint = ChartPoint & {
  candleRange: [number, number];
  vwap: number | null;
  ema20: number | null;
  ema50: number | null;
  rsi: number | null;
};

export type PriceLevels = {
  previousHigh: number | null;
  previousLow: number | null;
  support: number | null;
  resistance: number | null;
};

export type LiveTick = {
  ts: number;
  price: number;
  volume?: number;
};

export const TIMEFRAMES = ["1m", "5m", "15m", "1h", "1d"];
const MARKET_OPEN_MIN = 9 * 60 + 15;
const MARKET_CLOSE_MIN = 15 * 60 + 30;

export function finiteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function dateKey(dt: Date) {
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${month}-${day}`;
}

export function sessionLabel(date: string) {
  const dt = new Date(`${date}T00:00:00`);
  return dt.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function isMarketPoint(p: ChartPoint) {
  const dt = new Date(p.ts * 1000);
  const mins = dt.getHours() * 60 + dt.getMinutes();
  return mins >= MARKET_OPEN_MIN && mins <= MARKET_CLOSE_MIN;
}

export function normalizeCandle(c: RawCandle, isDaily: boolean): ChartPoint | null {
  const ts = Array.isArray(c) ? finiteNumber(c[0]) : finiteNumber(c.time ?? c.timestamp ?? c.ts);
  const close = Array.isArray(c) ? finiteNumber(c[4]) : finiteNumber(c.close ?? c.c ?? c.price);
  if (ts === null || close === null) return null;

  const open = Array.isArray(c) ? finiteNumber(c[1]) ?? close : finiteNumber(c.open ?? c.o) ?? close;
  const high = Array.isArray(c) ? finiteNumber(c[2]) ?? close : finiteNumber(c.high ?? c.h) ?? close;
  const low = Array.isArray(c) ? finiteNumber(c[3]) ?? close : finiteNumber(c.low ?? c.l) ?? close;
  const volume = Array.isArray(c) ? finiteNumber(c[5]) ?? 0 : finiteNumber(c.volume ?? c.v) ?? 0;
  const dt = new Date(ts * 1000);

  return {
    ts,
    date: dateKey(dt),
    time: isDaily
      ? dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
      : dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
    label: dt.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    open: Math.round(open * 100) / 100,
    high: Math.round(high * 100) / 100,
    low: Math.round(low * 100) / 100,
    close: Math.round(close * 100) / 100,
    price: Math.round(close * 100) / 100,
    volume,
  };
}

export function selectChartPoints(points: ChartPoint[], isDaily: boolean) {
  if (isDaily) {
    return points.sort((a, b) => a.ts - b.ts);
  }

  const marketPoints = points.filter(isMarketPoint);
  const source = marketPoints.length >= 2 ? marketPoints : points;
  const grouped = new Map<string, ChartPoint[]>();

  for (const p of source) {
    grouped.set(p.date, [...(grouped.get(p.date) || []), p]);
  }

  return (
    Array.from(grouped.values())
      .filter((session) => session.length >= 2)
      .sort((a, b) => b[b.length - 1].ts - a[a.length - 1].ts)[0] || source
  ).sort((a, b) => a.ts - b.ts);
}

export function mergeLiveTick(points: ChartPoint[], tick: LiveTick | null, isDaily: boolean, timeframeSeconds = 300) {
  if (!tick || isDaily || points.length === 0) return points;

  const last = points[points.length - 1];
  if (tick.ts < last.ts) return points;

  const lastBucket = Math.floor(last.ts / timeframeSeconds);
  const tickBucket = Math.floor(tick.ts / timeframeSeconds);
  const startsNewCandle = tickBucket > lastBucket;
  const candleTs = tickBucket * timeframeSeconds;
  const dt = new Date(candleTs * 1000);
  const livePoint: ChartPoint = {
    ...last,
    ts: candleTs,
    date: dateKey(dt),
    time: dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }),
    label: dt.toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
    open: startsNewCandle ? tick.price : last.open,
    high: startsNewCandle ? tick.price : Math.max(last.high, tick.price),
    low: startsNewCandle ? tick.price : Math.min(last.low, tick.price),
    close: tick.price,
    price: tick.price,
    volume: startsNewCandle ? tick.volume ?? 0 : last.volume + (tick.volume ?? 0),
    live: true,
  };

  return startsNewCandle ? [...points, livePoint] : [...points.slice(0, -1), livePoint];
}

export function calculateChartStudies(points: ChartPoint[]): ChartStudyPoint[] {
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;
  let ema20: number | null = null;
  let ema50: number | null = null;
  const gains: number[] = [];
  const losses: number[] = [];

  return points.map((point, index) => {
    const typicalPrice = (point.high + point.low + point.close) / 3;
    cumulativePriceVolume += typicalPrice * Math.max(0, point.volume);
    cumulativeVolume += Math.max(0, point.volume);
    ema20 = ema20 === null ? point.close : point.close * (2 / 21) + ema20 * (19 / 21);
    ema50 = ema50 === null ? point.close : point.close * (2 / 51) + ema50 * (49 / 51);

    if (index > 0) {
      const change = point.close - points[index - 1].close;
      gains.push(Math.max(0, change));
      losses.push(Math.max(0, -change));
    }
    const recentGains = gains.slice(-14);
    const recentLosses = losses.slice(-14);
    const avgGain = recentGains.length === 14 ? recentGains.reduce((sum, value) => sum + value, 0) / 14 : null;
    const avgLoss = recentLosses.length === 14 ? recentLosses.reduce((sum, value) => sum + value, 0) / 14 : null;
    const rsi = avgGain === null || avgLoss === null
      ? null
      : avgLoss === 0
        ? 100
        : 100 - (100 / (1 + avgGain / avgLoss));

    return {
      ...point,
      candleRange: [point.low, point.high],
      vwap: cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : null,
      ema20: index >= 19 ? ema20 : null,
      ema50: index >= 49 ? ema50 : null,
      rsi,
    };
  });
}

export function calculatePriceLevels(allPoints: ChartPoint[], sessionPoints: ChartPoint[]): PriceLevels {
  const currentDate = sessionPoints[sessionPoints.length - 1]?.date;
  const earlierSessions = allPoints.filter((point) => currentDate && point.date < currentDate);
  const previousDate = earlierSessions.length ? earlierSessions[earlierSessions.length - 1].date : null;
  const previous = previousDate ? earlierSessions.filter((point) => point.date === previousDate) : [];
  const completed = sessionPoints.filter((point) => !point.live).slice(-20);
  return {
    previousHigh: previous.length ? Math.max(...previous.map((point) => point.high)) : null,
    previousLow: previous.length ? Math.min(...previous.map((point) => point.low)) : null,
    support: completed.length >= 5 ? Math.min(...completed.map((point) => point.low)) : null,
    resistance: completed.length >= 5 ? Math.max(...completed.map((point) => point.high)) : null,
  };
}

export function yDomain(points: ChartPoint[]) {
  if (points.length === 0) return ["auto", "auto"] as const;
  const low = Math.min(...points.map((p) => p.low));
  const high = Math.max(...points.map((p) => p.high));
  const pad = Math.max((high - low) * 0.08, high * 0.001, 1);
  return [Math.floor((low - pad) * 100) / 100, Math.ceil((high + pad) * 100) / 100];
}

