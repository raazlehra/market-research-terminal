// Pure Fyers API v3 Integration Client
// This client directly connects to your real custom API proxy. No simulated/fake responses are returned.

export interface LoginResponse {
  url: string;
}

export interface ExchangeResponse {
  session_token: string;
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
  iv: number | null;
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

export type AssetType = "equity" | "fno" | "crypto";

export interface AnalysisRequest {
  asset_type: AssetType;
  symbol: string;
  horizon: string;
  research_depth: "quick" | "standard" | "deep";
  resolution?: string;
  expiry?: string;
  ai_requested?: boolean;
}

export interface AgentEvidence {
  agent: string;
  status: "available" | "unavailable";
  conclusion: string;
  evidence: string[];
}

export interface AnalysisResult {
  instrument: Record<string, unknown>;
  asset_type: AssetType;
  horizon: string;
  signal: "STRONG BUY" | "BUY" | "HOLD" | "SELL" | "STRONG SELL" | "NO CLEAR SETUP";
  confidence: number;
  signal_type: "analysis_only";
  execution_enabled: false;
  market_bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  technical_condition: string;
  fundamental_condition: string;
  sentiment_news_condition: string;
  futures_confirmation?: string | null;
  options_oi_confirmation?: string | null;
  volatility: string;
  volume_condition: string;
  bullish_evidence: string[];
  bearish_evidence: string[];
  risks: string[];
  important_levels: { support: number | null; resistance: number | null };
  important_strikes: number[];
  invalidation_conditions: string[];
  reasoning_summary: string;
  agents: AgentEvidence[];
  data_timestamp: string;
  generated_at: string;
  data_freshness: "REAL TIME" | "DELAYED" | "HISTORICAL" | "CACHED";
  data_sources: string[];
  snapshot_id: string;
  research_depth: string;
  model: string;
  cached: boolean;
  analysis_mode: "deterministic" | "llm";
  ai_status: "disabled" | "completed" | "unavailable";
  cost_notice: string;
}

export interface AnalysisConfig {
  enabled: boolean;
  provider: string;
  model: string;
  framework: string;
  commit: string;
  cost_notice: string;
}

export interface FuturesContract {
  underlying: string;
  exchange: string;
  contract_symbol: string;
  expiry_timestamp: number;
  expiry: string;
  lot_size: number;
  previous_close: number | null;
  previous_open_interest: number | null;
  instrument_type: number;
}

export interface FuturesMarketSnapshot {
  instrument: { asset_type: "future"; underlying: string; exchange: string; contract_symbol: string; expiry: string; lot_size: number };
  market: {
    futures_price: number | null;
    spot_price: number | null;
    basis: number | null;
    basis_percent: number | null;
    premium_discount: string;
    open: number | null;
    high: number | null;
    low: number | null;
    previous_close: number | null;
    volume: number | null;
    open_interest: number | null;
    previous_open_interest: number | null;
    change_in_open_interest: number | null;
    days_to_expiry: number;
  };
  contracts: FuturesContract[];
  candles: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>;
  indicators: Record<string, unknown>;
  data_timestamp: string;
  data_freshness: "REAL TIME" | "DELAYED";
  data_sources: string[];
  interpretation_limits: string[];
}

export interface CryptoCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CryptoMarketSnapshot {
  instrument: { asset_type: "crypto"; symbol: string; base_asset: string; quote_asset: string; provider: string };
  market: { last_price: number | null; change: number | null; change_percent_24h: number | null; open_24h: number | null; high_24h: number | null; low_24h: number | null; base_volume_24h: number | null; quote_volume_24h: number | null; market_cap: null; circulating_supply: null; };
  candles: CryptoCandle[];
  indicators: Record<string, unknown>;
  data_timestamp: string;
  data_freshness: "REAL TIME" | "DELAYED";
  data_sources: string[];
  limitations: string[];
}
