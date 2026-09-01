// Pure Fyers API v3 Integration Client
// This client directly connects to your real custom API proxy. No simulated/fake responses are returned.

export interface LoginResponse {
  url: string;
}

export interface ExchangeResponse {
  access_token: string;
  user: {
    name: string;
    id: string;
    email: string;
  };
}

export interface OptionContract {
  symbol: string;
  oi: number;
  oi_change: number;
  volume: number;
  iv: number;
  ltp: number;
  bid: number;
  ask: number;
  itm?: boolean;
}

export interface OptionChainRow {
  strike: number;
  ce: OptionContract | null;
  pe: OptionContract | null;
}

export interface ExpiryRecord {
  date?: string;
  expiry: string | number;
  flag?: string;
}

export interface OptionChainResponse {
  symbol: string;
  expiry?: string;
  spot: number;
  atm: number | null;
  step: number;
  chain: OptionChainRow[];
  pcr: number;
  ce_oi: number;
  pe_oi: number;
  expiries: ExpiryRecord[];
  vwap: number | null;
  ema20: number | null;
  ema50: number | null;
  vwap15: number | null;
  ema2015: number | null;
  ema5015: number | null;
  vwap60: number | null;
  ema2060: number | null;
  ema5060: number | null;
  message?: string;
  fetched_at?: string;
  analysis?: MarketAnalysis;
}

export interface MarketTimeframeAnalysis {
  available: boolean;
  candles: number;
  fresh: boolean;
  vwap: number | null;
  ema20: number | null;
  ema50: number | null;
  rsi14: number | null;
  atr14: number | null;
  support: number | null;
  resistance: number | null;
  direction: "BULLISH" | "BEARISH" | "MIXED" | "UNKNOWN";
  candle_direction: "bullish" | "bearish" | "neutral";
  candle_confirmed: boolean;
  volume_ratio: number | null;
  last_candle_ts: number | null;
}

export interface MarketAnalysis {
  symbol: string;
  generated_at: number;
  timeframes: Record<"5" | "15" | "60", MarketTimeframeAnalysis>;
  overall: {
    direction: "BULLISH" | "BEARISH" | "MIXED";
    score: number;
    timeframes_available: number;
    aligned_timeframes: number;
    fresh: boolean;
  };
}
