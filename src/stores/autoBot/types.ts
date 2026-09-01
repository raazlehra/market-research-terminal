import type { MarketRegime } from "../../lib/marketRegime";

export type CandlePatternContext = {
  candlePattern?: string;
  candleDirection?: "bullish" | "bearish" | "neutral";
  candleScore?: number;
  candleEntry?: number | null;
  candleSl?: number | null;
  candleVolumeConfirmed?: boolean;
  candleTimeframe?: string;
  marketRegime?: MarketRegime;
};

export type BotTradeOptions = CandlePatternContext & {
  price?: number;
  confidence?: number;
  strategy?: string;
  sl?: number;
  t1?: number;
  t2?: number;
  source?: "scanner" | "tick" | "option_chain";
};

export type OptionChainTradeOptions = CandlePatternContext & {
  symbol: string;
  optionSide: "CE" | "PE";
  lotSize: number;
  requestedLots?: number;
  maxLots?: number;
  sizingMode?: OptionSizingMode;
  price: number;
  sl: number;
  t1: number;
  t2: number;
  confidence: number;
  bias: "Bullish" | "Bearish" | "Neutral" | string;
  strike?: number;
  expiry?: string;
  expiryLabel?: string;
  bid?: number;
  ask?: number;
  volume?: number;
  oi?: number;
  spot?: number;
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
};

export type OptionSizingMode = "fixed" | "risk" | "smaller";
export type BotExecutionMode = "dry_run" | "paper_auto";
export type CandleConfirmationMode = "off" | "log" | "block_opposite";

export type OptionIndexRiskConfig = {
  enabled: boolean;
  requestedLots: number;
  maxLots: number;
};

export type ManagedExitState = {
  t1Done?: boolean;
  t2Done?: boolean;
  highWater?: number;
  lowWater?: number;
  trailStop?: number;
};

export type BotDecisionLog = {
  id: string;
  time: string;
  status: "CHECK" | "TRADE" | "SKIP" | "BLOCKED" | "ERROR";
  message: string;
  symbol?: string;
  side?: "BUY" | "SELL";
  confidence?: number;
  strategy?: string;
  source?: "scanner" | "tick" | "option_chain";
  details?: Record<string, unknown> | null;
};

export type OptionWatchRow = {
  index: string;
  label: string;
  symbol?: string;
  optionSide?: "CE" | "PE";
  strike?: number;
  bias?: string;
  confluence?: number;
  recommendationScore?: number;
  liquidityScore?: number;
  expiryScore?: number;
  chartScore?: number;
  finalScore?: number;
  status: "READY" | "BLOCKED" | "ERROR";
  reason?: string;
};

export type OptionSizingSnapshot = {
  symbol: string;
  sizingMode: OptionSizingMode;
  requestedLots: number;
  maxLots: number;
  lotSize: number;
  requestedQty: number;
  entry: number;
  sl: number;
  riskPerQty: number;
  riskBudget: number;
  available: number;
  exposureRoom: number;
  maxQtyByRisk: number;
  maxQtyByCash: number;
  maxQtyByExposure: number;
  finalQty: number;
  finalLots: number;
  adjusted: boolean;
  blocked?: string;
  message?: string;
};

export type AddDecisionLog = (entry: Omit<BotDecisionLog, "id" | "time">) => void;
export type SetBotState = (patch: Partial<AutoBotState>) => void;
export type PlayAlert = () => void;

export interface AutoBotState {
  enabled: boolean;
  paused: boolean;
  strategy: string;
  universe: string;
  timeframe: string;
  minConfidence: number;
  riskPerTrade: number;
  maxTradesPerDay: number;
  minT1RewardRisk: number;
  minT2RewardRisk: number;
  autoExitEnabled: boolean;
  trailingSlEnabled: boolean;
  optionIndexWatchEnabled: boolean;
  executionMode: BotExecutionMode;
  candleConfirmationMode: CandleConfirmationMode;
  minCandleScore: number;
  requireCandleVolume: boolean;
  regimeGuardEnabled: boolean;
  regimeGuardMinCandleScore: number;
  guardedRegimes: MarketRegime[];
  adaptivePatternConfidenceEnabled: boolean;
  maxPatternConfidenceAdjustment: number;
  optionSizingMode: OptionSizingMode;
  optionIndexRisk: Record<string, OptionIndexRiskConfig>;
  t1ExitPercent: number;
  tradesExecuted: number;
  lastAction: string;
  decisionLog: BotDecisionLog[];
  optionWatchRows: OptionWatchRow[];
  lastOptionSizing: OptionSizingSnapshot | null;
  toggleEnabled: () => void;
  togglePaused: () => void;
  setStrategy: (strategy: string) => void;
  setUniverse: (universe: string) => void;
  setTimeframe: (timeframe: string) => void;
  setMinConfidence: (minConfidence: number) => void;
  setMaxTradesPerDay: (maxTradesPerDay: number) => void;
  setMinT1RewardRisk: (minT1RewardRisk: number) => void;
  setMinT2RewardRisk: (minT2RewardRisk: number) => void;
  setRiskPerTrade: (riskPerTrade: number) => void;
  setAutoExitEnabled: (autoExitEnabled: boolean) => void;
  setTrailingSlEnabled: (trailingSlEnabled: boolean) => void;
  setOptionIndexWatchEnabled: (optionIndexWatchEnabled: boolean) => void;
  setExecutionMode: (executionMode: BotExecutionMode) => void;
  setCandleConfirmationMode: (mode: CandleConfirmationMode) => void;
  setMinCandleScore: (score: number) => void;
  setRequireCandleVolume: (required: boolean) => void;
  setRegimeGuardEnabled: (enabled: boolean) => void;
  setRegimeGuardMinCandleScore: (score: number) => void;
  setGuardedRegimes: (regimes: MarketRegime[]) => void;
  setAdaptivePatternConfidenceEnabled: (enabled: boolean) => void;
  setMaxPatternConfidenceAdjustment: (points: number) => void;
  setOptionSizingMode: (optionSizingMode: OptionSizingMode) => void;
  setOptionIndexRisk: (indexLabel: string, patch: Partial<OptionIndexRiskConfig>) => void;
  setT1ExitPercent: (t1ExitPercent: number) => void;
  hydrateBotConfig: (patch: Partial<AutoBotState>) => void;
  hydrateDecisionLog: (rows: BotDecisionLog[]) => void;
  loadDecisionLog: () => Promise<void>;
  clearDecisionLog: () => void;
  triggerBotTrade: (symbol: string, side: "BUY" | "SELL", qty: number, reason: string, options?: BotTradeOptions) => Promise<boolean>;
  triggerOptionChainTrade: (options: OptionChainTradeOptions) => Promise<boolean>;
}
