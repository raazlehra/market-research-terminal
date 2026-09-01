import { SCANNERS } from "../../lib/scanners";

export type SideFilter = "ALL" | "BUY" | "SELL";
export type SortKey = "confidence" | "change" | "volume" | "symbol";

export type ScannerResult = {
  symbol: string;
  side: "BUY" | "SELL";
  ltp: number;
  chp: number;
  volume: number;
  signal: string;
  entry: number;
  sl: number;
  t1: number;
  t2: number;
  confidence: number;
  factors?: Partial<Record<"trend" | "volume" | "momentum" | "support" | "rr" | "range", number>>;
};

export type ScannerResponse = {
  results?: ScannerResult[];
  scanned?: number;
  history_requested?: number;
  history_ok?: number;
  history_failed?: number;
  elapsed?: number;
  prefiltered?: number;
  cached?: boolean;
  cooldown_remaining?: number;
  busy?: boolean;
  message?: string;
  rate_limit_per_second?: number;
};

export type SavedScannerSnapshot = {
  savedAt: string | null;
  results: ScannerResult[];
};

export const TIMEFRAMES = [
  { value: "5", label: "5 Minute" },
  { value: "15", label: "15 Minute" },
  { value: "60", label: "1 Hour" },
];
export const DEFAULT_STRATEGY = SCANNERS[0]?.v || "VWAP_BREAKOUT";

export const FACTORS: Array<keyof NonNullable<ScannerResult["factors"]>> = [
  "trend",
  "volume",
  "momentum",
  "support",
  "rr",
  "range",
];

export function storageKey(universe: string, strategy: string, timeframe: string) {
  return `stocks_last_scan:${universe}:${strategy}:${timeframe}`;
}

export function readSavedResults(key: string): ScannerResult[] {
  return readSavedSnapshot(key).results;
}

export function readSavedSnapshot(key: string): SavedScannerSnapshot {
  if (typeof window === "undefined") return { savedAt: null, results: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    return {
      savedAt: typeof saved?.savedAt === "string" ? saved.savedAt : null,
      results: Array.isArray(saved?.results) ? saved.results : [],
    };
  } catch {
    return { savedAt: null, results: [] };
  }
}

export function validTradeLevels(stock: ScannerResult) {
  const { entry, sl, t1, t2, side } = stock;
  if (![entry, sl, t1, t2].every((value) => Number.isFinite(Number(value)) && Number(value) > 0)) return false;
  return side === "BUY"
    ? sl < entry && entry < t1 && t1 < t2
    : sl > entry && entry > t1 && t1 > t2;
}

export function numberValue(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function volumeLabel(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "-";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
  return value.toLocaleString("en-IN");
}

export function confidenceTone(confidence: number) {
  if (confidence >= 80) return {
    text: "text-emerald-400",
    card: "bg-emerald-500/10 border-emerald-500/30",
    button: "bg-emerald-600 hover:bg-emerald-500",
  };
  if (confidence >= 65) return {
    text: "text-emerald-300",
    card: "bg-emerald-500/5 border-emerald-500/20",
    button: "bg-emerald-700 hover:bg-emerald-600",
  };
  if (confidence >= 50) return {
    text: "text-slate-300",
    card: "bg-slate-800/30 border-slate-700",
    button: "bg-slate-700 hover:bg-slate-600",
  };
  return {
    text: "text-rose-300",
    card: "bg-rose-500/5 border-rose-500/20",
    button: "bg-slate-700 hover:bg-slate-600",
  };
}

