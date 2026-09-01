import type { AutoBotState, BotDecisionLog, ManagedExitState } from "./types";

export const BOT_COUNT_KEY = "bot_trades_executed";
export const BOT_CONFIG_KEY = "fyers_auto_bot_settings";
export const BOT_DECISION_LOG_KEY = "fyers_auto_bot_decision_log";
export const BOT_MANAGED_EXITS_KEY = "fyers_auto_bot_managed_exits";
export const BOT_SCAN_INTERVAL_MS = 15000;
export const BOT_OPTION_WATCH_INTERVAL_MS = 45000;
export const BOT_EXIT_INTERVAL_MS = 12000;
export const DEFAULT_BOT_STRATEGY = "VWAP_BREAKOUT";

export function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function readBotConfig() {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(BOT_CONFIG_KEY) || "{}");
  } catch {
    return {};
  }
}

export function saveBotConfig(patch: Partial<AutoBotState>) {
  if (typeof localStorage === "undefined") return;
  const current = readBotConfig();
  const allowed = {
    strategy: patch.strategy,
    universe: patch.universe,
    timeframe: patch.timeframe,
    minConfidence: patch.minConfidence,
    maxTradesPerDay: patch.maxTradesPerDay,
    minT1RewardRisk: patch.minT1RewardRisk,
    minT2RewardRisk: patch.minT2RewardRisk,
    riskPerTrade: patch.riskPerTrade,
    autoExitEnabled: patch.autoExitEnabled,
    trailingSlEnabled: patch.trailingSlEnabled,
    optionIndexWatchEnabled: patch.optionIndexWatchEnabled,
    executionMode: patch.executionMode,
    candleConfirmationMode: patch.candleConfirmationMode,
    minCandleScore: patch.minCandleScore,
    requireCandleVolume: patch.requireCandleVolume,
    regimeGuardEnabled: patch.regimeGuardEnabled,
    regimeGuardMinCandleScore: patch.regimeGuardMinCandleScore,
    guardedRegimes: patch.guardedRegimes,
    adaptivePatternConfidenceEnabled: patch.adaptivePatternConfidenceEnabled,
    maxPatternConfidenceAdjustment: patch.maxPatternConfidenceAdjustment,
    optionSizingMode: patch.optionSizingMode,
    optionIndexRisk: patch.optionIndexRisk,
    t1ExitPercent: patch.t1ExitPercent,
  };
  const next = Object.fromEntries(
    Object.entries({ ...current, ...allowed }).filter(([, value]) => value !== undefined)
  );
  localStorage.setItem(BOT_CONFIG_KEY, JSON.stringify(next));
}

export function readDecisionLog(): BotDecisionLog[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(BOT_DECISION_LOG_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 50) : [];
  } catch {
    return [];
  }
}

export function writeDecisionLog(rows: BotDecisionLog[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(BOT_DECISION_LOG_KEY, JSON.stringify(rows.slice(0, 50)));
}

export function readManagedExits(): Record<string, ManagedExitState> {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(BOT_MANAGED_EXITS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeManagedExits(value: Record<string, ManagedExitState>) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(BOT_MANAGED_EXITS_KEY, JSON.stringify(value));
}

export function localDayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function readTradeCount() {
  if (typeof sessionStorage === "undefined") return 0;
  const raw = sessionStorage.getItem(BOT_COUNT_KEY);
  if (!raw) return 0;

  try {
    const parsed = JSON.parse(raw);
    return parsed?.date === localDayKey() ? Number(parsed.count || 0) : 0;
  } catch {
    const legacyCount = Number(raw);
    return Number.isFinite(legacyCount) ? legacyCount : 0;
  }
}

export function writeTradeCount(count: number) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(BOT_COUNT_KEY, JSON.stringify({ date: localDayKey(), count }));
}
