import { create } from "zustand";
import { useSettings } from "./settingsStore";
import { api } from "../lib/api";
import { createDecisionLogEntry, persistNextDecisionLog } from "./autoBot/decisionLog";
import { manageOpenPaperPositions } from "./autoBot/exits";
import { runOptionIndexWatchOnce } from "./autoBot/optionIndexWatch";
import { triggerOptionBotTrade } from "./autoBot/optionExecution";
import { runScannerOnce } from "./autoBot/scanner";
import { triggerStockBotTrade } from "./autoBot/stockExecution";
import { installAutoBotTickListener } from "./autoBot/tickListener";
import {
  clampLots,
  normalizeCandleConfirmationMode,
  normalizeExecutionMode,
  normalizeGuardedRegimes,
  normalizeOptionIndexRisk,
  normalizeOptionSizingMode,
  persistBotConfig,
} from "./autoBot/config";
import {
  BOT_EXIT_INTERVAL_MS,
  BOT_OPTION_WATCH_INTERVAL_MS,
  BOT_SCAN_INTERVAL_MS,
  DEFAULT_BOT_STRATEGY,
  clampNumber,
  readBotConfig,
  readDecisionLog,
  readTradeCount,
  saveBotConfig,
  writeDecisionLog,
} from "./autoBot/storage";
import type { AutoBotState, BotDecisionLog } from "./autoBot/types";

export type { BotDecisionLog } from "./autoBot/types";

const botConfig = readBotConfig() as Partial<AutoBotState>;

let scanTimer: ReturnType<typeof setInterval> | null = null;
let exitTimer: ReturnType<typeof setInterval> | null = null;
let optionWatchTimer: ReturnType<typeof setInterval> | null = null;
const scanInFlightRef = { current: false };
const exitInFlightRef = { current: false };
const optionWatchInFlightRef = { current: false };

function addDecisionLog(entry: Omit<BotDecisionLog, "id" | "time">) {
  const row = createDecisionLogEntry(entry);
  useAutoBot.setState((state) => ({
    decisionLog: persistNextDecisionLog(state.decisionLog, row),
  }));
  void api.saveBotDecision(row).catch(() => {});
}

function playAlertIfEnabled() {
  if (!useSettings.getState().soundAlerts) return;
  try {
    const audio = new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg");
    audio.play().catch(() => {});
  } catch {}
}

function stopScannerLoop() {
  if (!scanTimer) return;
  clearInterval(scanTimer);
  scanTimer = null;
}

function stopExitLoop() {
  if (!exitTimer) return;
  clearInterval(exitTimer);
  exitTimer = null;
}

function stopOptionWatchLoop() {
  if (!optionWatchTimer) return;
  clearInterval(optionWatchTimer);
  optionWatchTimer = null;
}

function setLastAction(lastAction: string) {
  useAutoBot.setState({ lastAction });
}

function setBotState(patch: Partial<AutoBotState>) {
  useAutoBot.setState(patch);
}

function startScannerLoop() {
  if (typeof window === "undefined" || scanTimer) return;
  window.setTimeout(() => {
    void runScannerOnce(() => useAutoBot.getState(), addDecisionLog, scanInFlightRef, setLastAction);
  }, 0);
  scanTimer = setInterval(() => {
    void runScannerOnce(() => useAutoBot.getState(), addDecisionLog, scanInFlightRef, setLastAction);
  }, BOT_SCAN_INTERVAL_MS);
}

function startExitLoop() {
  if (typeof window === "undefined" || exitTimer) return;
  void manageOpenPaperPositions(() => useAutoBot.getState(), addDecisionLog, exitInFlightRef, setLastAction);
  exitTimer = setInterval(() => {
    void manageOpenPaperPositions(() => useAutoBot.getState(), addDecisionLog, exitInFlightRef, setLastAction);
  }, BOT_EXIT_INTERVAL_MS);
}

function startOptionWatchLoop() {
  if (typeof window === "undefined" || optionWatchTimer) return;
  window.setTimeout(() => {
    void runOptionIndexWatchOnce(() => useAutoBot.getState(), addDecisionLog, optionWatchInFlightRef, setLastAction, setBotState);
  }, 0);
  optionWatchTimer = setInterval(() => {
    void runOptionIndexWatchOnce(() => useAutoBot.getState(), addDecisionLog, optionWatchInFlightRef, setLastAction, setBotState);
  }, BOT_OPTION_WATCH_INTERVAL_MS);
}

export const useAutoBot = create<AutoBotState>((set, get) => ({
  enabled: false,
  paused: false,
  strategy: botConfig.strategy || DEFAULT_BOT_STRATEGY,
  universe: botConfig.universe || "FNO",
  timeframe: botConfig.timeframe || "15",
  minConfidence: clampNumber(Number(botConfig.minConfidence ?? 65), 0, 95),
  riskPerTrade: clampNumber(Number(botConfig.riskPerTrade ?? 1000), 100, 1000000),
  maxTradesPerDay: clampNumber(Number(botConfig.maxTradesPerDay ?? 5), 1, 50),
  minT1RewardRisk: clampNumber(Number(botConfig.minT1RewardRisk ?? 1.2), 0.5, 10),
  minT2RewardRisk: clampNumber(Number(botConfig.minT2RewardRisk ?? 2), 0.5, 10),
  autoExitEnabled: botConfig.autoExitEnabled ?? true,
  trailingSlEnabled: botConfig.trailingSlEnabled ?? true,
  optionIndexWatchEnabled: botConfig.optionIndexWatchEnabled ?? false,
  executionMode: normalizeExecutionMode(botConfig.executionMode),
  candleConfirmationMode: normalizeCandleConfirmationMode(botConfig.candleConfirmationMode),
  minCandleScore: clampNumber(Number(botConfig.minCandleScore ?? 72), 0, 100),
  requireCandleVolume: botConfig.requireCandleVolume ?? false,
  regimeGuardEnabled: botConfig.regimeGuardEnabled ?? true,
  regimeGuardMinCandleScore: clampNumber(Number(botConfig.regimeGuardMinCandleScore ?? 85), 0, 100),
  guardedRegimes: normalizeGuardedRegimes(botConfig.guardedRegimes),
  adaptivePatternConfidenceEnabled: botConfig.adaptivePatternConfidenceEnabled ?? false,
  maxPatternConfidenceAdjustment: clampNumber(Number(botConfig.maxPatternConfidenceAdjustment ?? 5), 0, 15),
  optionSizingMode: normalizeOptionSizingMode(botConfig.optionSizingMode),
  optionIndexRisk: normalizeOptionIndexRisk(botConfig.optionIndexRisk),
  t1ExitPercent: clampNumber(Number(botConfig.t1ExitPercent ?? 50), 10, 100),
  tradesExecuted: readTradeCount(),
  lastAction: "Bot idle. Enable to start monitoring scanner signals.",
  decisionLog: readDecisionLog(),
  optionWatchRows: [],
  lastOptionSizing: null,
  toggleEnabled: () => {
    set((state) => {
      const enabled = !state.enabled;
      if (enabled) {
        startScannerLoop();
        startExitLoop();
        if (get().optionIndexWatchEnabled) startOptionWatchLoop();
      } else {
        stopScannerLoop();
        stopExitLoop();
        stopOptionWatchLoop();
      }

      return {
        enabled,
        paused: false,
        tradesExecuted: readTradeCount(),
        lastAction: enabled ? "Auto-Bot enabled. Scanning every 15s and waiting for a valid signal." : "Auto-Bot stopped.",
      };
    });
  },
  togglePaused: () => {
    set((state) => {
      if (!state.enabled) return { paused: false };
      const paused = !state.paused;
      if (paused) {
        stopScannerLoop();
        stopExitLoop();
        stopOptionWatchLoop();
      } else {
        startScannerLoop();
        startExitLoop();
        if (get().optionIndexWatchEnabled) startOptionWatchLoop();
      }

      return {
        paused,
        lastAction: paused ? "Auto-Bot paused. Signal execution on standby." : "Auto-Bot resumed. Scanning every 15s and waiting for a valid signal.",
      };
    });
  },
  setStrategy: (strategy) => {
    persistBotConfig({ strategy });
    set({ strategy, lastAction: `Auto-Bot strategy set to ${strategy}.` });
  },
  setUniverse: (universe) => {
    persistBotConfig({ universe });
    set({ universe, lastAction: `Auto-Bot universe set to ${universe}.` });
  },
  setTimeframe: (timeframe) => {
    persistBotConfig({ timeframe });
    set({ timeframe, lastAction: `Auto-Bot timeframe set to ${timeframe} minute.` });
  },
  setMinConfidence: (minConfidence) => {
    const value = clampNumber(Number(minConfidence), 0, 95);
    persistBotConfig({ minConfidence: value });
    set({ minConfidence: value });
  },
  setMaxTradesPerDay: (maxTradesPerDay) => {
    const value = clampNumber(Number(maxTradesPerDay), 1, 50);
    persistBotConfig({ maxTradesPerDay: value });
    set({ maxTradesPerDay: value });
  },
  setMinT1RewardRisk: (minT1RewardRisk) => {
    const value = clampNumber(Number(minT1RewardRisk), 0.5, 10);
    persistBotConfig({ minT1RewardRisk: value });
    set({ minT1RewardRisk: value, lastAction: `Minimum T1 R:R set to ${value.toFixed(2)}.` });
  },
  setMinT2RewardRisk: (minT2RewardRisk) => {
    const value = clampNumber(Number(minT2RewardRisk), 0.5, 10);
    persistBotConfig({ minT2RewardRisk: value });
    set({ minT2RewardRisk: value, lastAction: `Minimum T2 R:R set to ${value.toFixed(2)}.` });
  },
  setRiskPerTrade: (riskPerTrade) => {
    const value = clampNumber(Number(riskPerTrade), 100, 1000000);
    persistBotConfig({ riskPerTrade: value });
    set({ riskPerTrade: value, lastAction: `Risk per trade set to INR ${value.toFixed(2)}.` });
  },
  setAutoExitEnabled: (autoExitEnabled) => {
    persistBotConfig({ autoExitEnabled });
    set({ autoExitEnabled, lastAction: autoExitEnabled ? "Auto exits enabled." : "Auto exits disabled." });
    if (autoExitEnabled && get().enabled && !get().paused) startExitLoop();
    if (!autoExitEnabled) stopExitLoop();
  },
  setTrailingSlEnabled: (trailingSlEnabled) => {
    persistBotConfig({ trailingSlEnabled });
    set({ trailingSlEnabled, lastAction: trailingSlEnabled ? "Trailing SL enabled." : "Trailing SL disabled." });
  },
  setOptionIndexWatchEnabled: (optionIndexWatchEnabled) => {
    persistBotConfig({ optionIndexWatchEnabled });
    set({
      optionIndexWatchEnabled,
      lastAction: optionIndexWatchEnabled
        ? "Option index watch enabled. Scanning all indices every 45s."
        : "Option index watch disabled.",
    });
    if (optionIndexWatchEnabled && get().enabled && !get().paused) startOptionWatchLoop();
    if (!optionIndexWatchEnabled) stopOptionWatchLoop();
  },
  setExecutionMode: (executionMode) => {
    const value = normalizeExecutionMode(executionMode);
    persistBotConfig({ executionMode: value });
    set({
      executionMode: value,
      lastAction: value === "dry_run"
        ? "Auto-Bot execution set to Dry Run. Orders will be logged only."
        : "Auto-Bot execution set to Paper Auto. Valid signals can place paper orders.",
    });
  },
  setCandleConfirmationMode: (candleConfirmationMode) => {
    const value = normalizeCandleConfirmationMode(candleConfirmationMode);
    persistBotConfig({ candleConfirmationMode: value });
    set({
      candleConfirmationMode: value,
      lastAction: value === "off"
        ? "Candle confirmation disabled."
        : value === "log"
          ? "Candle confirmation set to log only."
          : "Candle confirmation will block strong opposite patterns.",
    });
  },
  setMinCandleScore: (minCandleScore) => {
    const value = clampNumber(Number(minCandleScore), 0, 100);
    persistBotConfig({ minCandleScore: value });
    set({ minCandleScore: value, lastAction: `Minimum candle score set to ${value}/100.` });
  },
  setRequireCandleVolume: (requireCandleVolume) => {
    persistBotConfig({ requireCandleVolume });
    set({
      requireCandleVolume,
      lastAction: requireCandleVolume ? "Candle confirmation now requires volume." : "Candle confirmation volume requirement disabled.",
    });
  },
  setRegimeGuardEnabled: (regimeGuardEnabled) => {
    persistBotConfig({ regimeGuardEnabled });
    set({
      regimeGuardEnabled,
      lastAction: regimeGuardEnabled ? "Regime guard enabled for weak option-buy signals." : "Regime guard disabled.",
    });
  },
  setRegimeGuardMinCandleScore: (regimeGuardMinCandleScore) => {
    const value = clampNumber(Number(regimeGuardMinCandleScore), 0, 100);
    persistBotConfig({ regimeGuardMinCandleScore: value });
    set({ regimeGuardMinCandleScore: value, lastAction: `Regime guard candle score set to ${value}/100.` });
  },
  setGuardedRegimes: (guardedRegimes) => {
    const value = normalizeGuardedRegimes(guardedRegimes);
    persistBotConfig({ guardedRegimes: value });
    set({ guardedRegimes: value, lastAction: `Regime guard set for ${value.join(", ")}.` });
  },
  setAdaptivePatternConfidenceEnabled: (adaptivePatternConfidenceEnabled) => {
    persistBotConfig({ adaptivePatternConfidenceEnabled });
    set({
      adaptivePatternConfidenceEnabled,
      lastAction: adaptivePatternConfidenceEnabled
        ? "Adaptive pattern score adjustment enabled."
        : "Adaptive pattern score adjustment disabled.",
    });
  },
  setMaxPatternConfidenceAdjustment: (maxPatternConfidenceAdjustment) => {
    const value = clampNumber(Number(maxPatternConfidenceAdjustment), 0, 15);
    persistBotConfig({ maxPatternConfidenceAdjustment: value });
    set({ maxPatternConfidenceAdjustment: value, lastAction: `Pattern score adjustment cap set to ${value} points.` });
  },
  setOptionSizingMode: (optionSizingMode) => {
    const value = normalizeOptionSizingMode(optionSizingMode);
    persistBotConfig({ optionSizingMode: value });
    set({ optionSizingMode: value, lastAction: `Option sizing mode set to ${value}.` });
  },
  setOptionIndexRisk: (indexLabel, patch) => {
    const current = get().optionIndexRisk;
    const existing = current[indexLabel] || { enabled: true, requestedLots: 1, maxLots: 1 };
    const requestedLots = clampLots(patch.requestedLots ?? existing.requestedLots, existing.requestedLots);
    const maxLots = clampLots(patch.maxLots ?? existing.maxLots, existing.maxLots);
    const nextRow = {
      enabled: patch.enabled ?? existing.enabled,
      requestedLots,
      maxLots: Math.max(requestedLots, maxLots),
    };
    const optionIndexRisk = normalizeOptionIndexRisk({
      ...current,
      [indexLabel]: nextRow,
    });
    persistBotConfig({ optionIndexRisk });
    set({ optionIndexRisk, lastAction: `${indexLabel} option lot rules updated.` });
  },
  setT1ExitPercent: (t1ExitPercent) => {
    const value = clampNumber(Number(t1ExitPercent), 10, 100);
    persistBotConfig({ t1ExitPercent: value });
    set({ t1ExitPercent: value });
  },
  hydrateBotConfig: (patch) => {
    const next = {
      strategy: patch.strategy || get().strategy,
      universe: patch.universe || get().universe,
      timeframe: patch.timeframe || get().timeframe,
      minConfidence: clampNumber(Number(patch.minConfidence ?? get().minConfidence), 0, 95),
      riskPerTrade: clampNumber(Number(patch.riskPerTrade ?? get().riskPerTrade), 100, 1000000),
      maxTradesPerDay: clampNumber(Number(patch.maxTradesPerDay ?? get().maxTradesPerDay), 1, 50),
      minT1RewardRisk: clampNumber(Number(patch.minT1RewardRisk ?? get().minT1RewardRisk), 0.5, 10),
      minT2RewardRisk: clampNumber(Number(patch.minT2RewardRisk ?? get().minT2RewardRisk), 0.5, 10),
      autoExitEnabled: patch.autoExitEnabled ?? get().autoExitEnabled,
      trailingSlEnabled: patch.trailingSlEnabled ?? get().trailingSlEnabled,
      optionIndexWatchEnabled: patch.optionIndexWatchEnabled ?? get().optionIndexWatchEnabled,
      executionMode: normalizeExecutionMode(patch.executionMode ?? get().executionMode),
      candleConfirmationMode: normalizeCandleConfirmationMode(patch.candleConfirmationMode ?? get().candleConfirmationMode),
      minCandleScore: clampNumber(Number(patch.minCandleScore ?? get().minCandleScore), 0, 100),
      requireCandleVolume: patch.requireCandleVolume ?? get().requireCandleVolume,
      regimeGuardEnabled: patch.regimeGuardEnabled ?? get().regimeGuardEnabled,
      regimeGuardMinCandleScore: clampNumber(Number(patch.regimeGuardMinCandleScore ?? get().regimeGuardMinCandleScore), 0, 100),
      guardedRegimes: normalizeGuardedRegimes(patch.guardedRegimes ?? get().guardedRegimes),
      adaptivePatternConfidenceEnabled: patch.adaptivePatternConfidenceEnabled ?? get().adaptivePatternConfidenceEnabled,
      maxPatternConfidenceAdjustment: clampNumber(Number(patch.maxPatternConfidenceAdjustment ?? get().maxPatternConfidenceAdjustment), 0, 15),
      optionSizingMode: normalizeOptionSizingMode(patch.optionSizingMode ?? get().optionSizingMode),
      optionIndexRisk: normalizeOptionIndexRisk(patch.optionIndexRisk ?? get().optionIndexRisk),
      t1ExitPercent: clampNumber(Number(patch.t1ExitPercent ?? get().t1ExitPercent), 10, 100),
    };
    saveBotConfig(next);
    set(next);
  },
  hydrateDecisionLog: (rows) => {
    const next = rows.slice(0, 50);
    writeDecisionLog(next);
    set({ decisionLog: next });
  },
  loadDecisionLog: async () => {
    const rows = await api.getBotDecisions(50);
    get().hydrateDecisionLog(rows);
  },
  clearDecisionLog: () => {
    writeDecisionLog([]);
    set({ decisionLog: [] });
    void api.clearBotDecisions().catch(() => {});
  },
  triggerBotTrade: (symbol, side, qty, reason, options = {}) =>
    triggerStockBotTrade(
      { getBot: get, setBot: set, addDecisionLog, playAlertIfEnabled },
      symbol,
      side,
      qty,
      reason,
      options
    ),
  triggerOptionChainTrade: (options) =>
    triggerOptionBotTrade({ getBot: get, setBot: set, addDecisionLog, playAlertIfEnabled }, options),
}));

installAutoBotTickListener(() => useAutoBot.getState());
