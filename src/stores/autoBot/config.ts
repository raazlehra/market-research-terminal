import { api } from "../../lib/api";
import { OPTION_INDEXES } from "../../lib/optionChainModel";
import { saveBotConfig } from "./storage";
import type { MarketRegime } from "../../lib/marketRegime";
import type { AutoBotState, BotExecutionMode, CandleConfirmationMode, OptionIndexRiskConfig, OptionSizingMode } from "./types";

export const DEFAULT_GUARDED_REGIMES: MarketRegime[] = ["RANGE", "LOW_VOLUME"];
const MARKET_REGIMES: MarketRegime[] = ["TREND_UP", "TREND_DOWN", "RANGE", "VOLATILE", "LOW_VOLUME"];

export function normalizeOptionSizingMode(value: unknown): OptionSizingMode {
  return value === "fixed" || value === "risk" || value === "smaller" ? value : "smaller";
}

export function normalizeExecutionMode(value: unknown): BotExecutionMode {
  return value === "paper_auto" ? "paper_auto" : "dry_run";
}

export function normalizeCandleConfirmationMode(value: unknown): CandleConfirmationMode {
  return value === "off" || value === "log" || value === "block_opposite" ? value : "block_opposite";
}

export function clampLots(value: unknown, fallback: number) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, 50));
}

function defaultOptionIndexRisk(): Record<string, OptionIndexRiskConfig> {
  return Object.fromEntries(
    OPTION_INDEXES.map((indexInfo) => [
      indexInfo.label,
      { enabled: true, requestedLots: 1, maxLots: 1 },
    ])
  );
}

export function normalizeOptionIndexRisk(value: unknown): Record<string, OptionIndexRiskConfig> {
  const input = value && typeof value === "object" ? value as Record<string, Partial<OptionIndexRiskConfig>> : {};
  const defaults = defaultOptionIndexRisk();
  return Object.fromEntries(
    OPTION_INDEXES.map((indexInfo) => {
      const saved = input[indexInfo.label] || {};
      const requestedLots = clampLots(saved.requestedLots, defaults[indexInfo.label].requestedLots);
      const maxLots = clampLots(saved.maxLots, Math.max(defaults[indexInfo.label].maxLots, requestedLots));
      return [
        indexInfo.label,
        {
          enabled: saved.enabled ?? defaults[indexInfo.label].enabled,
          requestedLots,
          maxLots: Math.max(requestedLots, maxLots),
        },
      ];
    })
  );
}

export function normalizeGuardedRegimes(value: unknown): MarketRegime[] {
  if (!Array.isArray(value)) return DEFAULT_GUARDED_REGIMES;
  const regimes = value.filter((item): item is MarketRegime =>
    typeof item === "string" && MARKET_REGIMES.includes(item as MarketRegime)
  );
  return regimes.length ? Array.from(new Set(regimes)) : DEFAULT_GUARDED_REGIMES;
}

export function persistBotConfig(patch: Partial<AutoBotState>) {
  saveBotConfig(patch);
  void api.saveBotSettings(patch).catch(() => {});
}
