import { calculateRiskBasedLotQty } from "./risk";
import type { OptionChainTradeOptions, OptionSizingSnapshot } from "./types";

type OptionSizingResult = Awaited<ReturnType<typeof calculateRiskBasedLotQty>>;

export function buildSizingSnapshot(
  options: OptionChainTradeOptions,
  sizing: OptionSizingResult,
  blocked?: string
): OptionSizingSnapshot {
  const details = sizing.details;
  const requestedLots = Math.max(1, Math.floor(Number(options.requestedLots || 1)));
  const lotSize = Math.max(1, Math.floor(Number(options.lotSize || 1)));
  const maxLots = Math.max(requestedLots, Math.floor(Number(options.maxLots || requestedLots)));
  return {
    symbol: String(options.symbol || ""),
    sizingMode: options.sizingMode || "smaller",
    requestedLots,
    maxLots,
    lotSize,
    requestedQty: Number(details?.requestedQty ?? requestedLots * lotSize),
    entry: Number(details?.price ?? options.price ?? 0),
    sl: Number(details?.stop ?? options.sl ?? 0),
    riskPerQty: Number(details?.riskPerUnit ?? Math.abs(Number(options.price || 0) - Number(options.sl || 0))),
    riskBudget: Number(details?.riskBudget ?? 0),
    available: Number(details?.available ?? 0),
    exposureRoom: Number(details?.exposureRoom ?? 0),
    maxQtyByRisk: Number(details?.maxQtyByRisk ?? 0),
    maxQtyByCash: Number(details?.maxQtyByCash ?? 0),
    maxQtyByExposure: Number(details?.maxQtyByExposure ?? 0),
    finalQty: Number(details?.finalQty ?? sizing.qty ?? 0),
    finalLots: Number(details?.finalLots ?? sizing.lots ?? 0),
    adjusted: Boolean(sizing.adjusted),
    blocked,
    message: sizing.message,
  };
}

export function optionSizingLogDetails(
  options: OptionChainTradeOptions,
  sizing: OptionSizingResult
): Record<string, unknown> {
  const details = sizing.details;
  const candleDetails = options.candlePattern ? {
    candle: options.candlePattern,
    candleScore: options.candleScore,
    candleDirection: options.candleDirection,
    candleVolume: options.candleVolumeConfirmed,
    candleTimeframe: options.candleTimeframe,
    marketRegime: options.marketRegime,
  } : {};
  return {
    optionSide: options.optionSide,
    requestedLots: details?.requestedLots ?? options.requestedLots ?? 1,
    maxLots: details?.maxLots ?? options.maxLots ?? options.requestedLots ?? 1,
    finalLots: details?.finalLots ?? sizing.lots,
    finalQty: details?.finalQty ?? sizing.qty,
    riskBudget: details?.riskBudget ?? 0,
    plannedRisk: details?.plannedRisk ?? 0,
    ...candleDetails,
  };
}

export function optionExecutionLogDetails(
  options: OptionChainTradeOptions,
  sizing: OptionSizingResult,
  executionMode: string
): Record<string, unknown> {
  return {
    ...optionSizingLogDetails(options, sizing),
    executionMode,
    entry: options.price,
    sl: options.sl,
    t1: options.t1,
    t2: options.t2,
    qty: sizing.qty,
  };
}

export function candleNote(options: OptionChainTradeOptions) {
  if (!options.candlePattern) return "";
  const score = Number.isFinite(Number(options.candleScore)) ? `${Math.round(Number(options.candleScore))}/100` : "--";
  const direction = options.candleDirection || "neutral";
  const volume = options.candleVolumeConfirmed ? "volume" : "no-volume";
  const regime = options.marketRegime ? ` Regime: ${options.marketRegime}.` : "";
  return ` Pattern: ${options.candlePattern} (${score}, ${direction}, ${volume}, ${options.candleTimeframe || "--"}m).${regime}`;
}

export function applyFixedSizingBlock(
  symbol: string,
  requestedLots: number,
  sizing: OptionSizingResult
): OptionSizingResult {
  if (sizing.lots <= 0 || sizing.lots >= requestedLots) return sizing;
  return {
    ...sizing,
    qty: 0,
    lots: 0,
    adjusted: true,
    blocked: `Fixed option sizing blocked ${symbol}. Requested ${requestedLots} lot(s), but risk rules allow ${sizing.details?.riskAllowedLots ?? sizing.lots} lot(s).`,
    message: "",
    details: {
      ...sizing.details!,
      finalQty: 0,
      finalLots: 0,
      plannedRisk: 0,
    },
  };
}
