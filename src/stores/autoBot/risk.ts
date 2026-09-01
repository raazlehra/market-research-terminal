import { api } from "../../lib/api";
import type { AutoBotState } from "./types";
import { useSettings } from "../settingsStore";

type SettingsState = ReturnType<typeof useSettings.getState>;

function openPositionRows(positions: unknown) {
  return Array.isArray(positions) ? positions : [];
}

function currentExposure(positionRows: any[]) {
  return positionRows.reduce((sum: number, position: any) => {
    const openQty = Math.abs(Number(position?.qty ?? position?.openQty ?? 0));
    const mark = Number(position?.ltp ?? position?.avgPrice ?? 0);
    return sum + openQty * mark;
  }, 0);
}

export type PositionSizingResult = {
  qty: number;
  adjusted: boolean;
  blocked?: string;
  message: string;
  details?: {
    requestedQty: number;
    price: number;
    stop: number;
    riskPerUnit: number;
    riskBudget: number;
    available: number;
    exposureRoom: number;
    maxQtyByRisk: number;
    maxQtyByCash: number;
    maxQtyByExposure: number;
    finalQty: number;
    plannedRisk: number;
    requestedLots?: number;
    maxLots?: number;
    lotSize?: number;
    finalLots?: number;
    riskAllowedLots?: number;
  };
};

export async function calculateRiskBasedQty(
  symbol: string,
  requestedQty: number,
  price: number,
  state: AutoBotState,
  settings: SettingsState,
  sl?: number
): Promise<PositionSizingResult> {
  const fallbackQty = Math.max(1, Math.floor(Number(requestedQty || 1)));
  const stop = Number(sl || 0);
  const riskPerUnit = Math.abs(price - stop);
  const baseDetails = {
    requestedQty: fallbackQty,
    price,
    stop,
    riskPerUnit: Number.isFinite(riskPerUnit) ? riskPerUnit : 0,
    riskBudget: Number(state.riskPerTrade || 0),
    available: 0,
    exposureRoom: 0,
    maxQtyByRisk: 0,
    maxQtyByCash: 0,
    maxQtyByExposure: 0,
    finalQty: fallbackQty,
    plannedRisk: Math.max(0, fallbackQty * (Number.isFinite(riskPerUnit) ? riskPerUnit : 0)),
  };

  if (!symbol || price <= 0 || stop <= 0 || riskPerUnit <= 0) {
    return {
      qty: fallbackQty,
      adjusted: false,
      message: `Using default qty ${fallbackQty}. Risk sizing needs a valid entry and SL.`,
      details: baseDetails,
    };
  }

  const [positions, balance] = await Promise.all([
    api.getPaperPositions().catch(() => []),
    api.getPaperBalance().catch(() => ({})),
  ]);

  const rows = openPositionRows(positions);
  const available = Number((balance as any)?.available ?? 0);
  const exposureRoom = Math.max(Number(settings.riskMaxExposure || 0) - currentExposure(rows), 0);
  const riskQty = Math.floor(state.riskPerTrade / riskPerUnit);
  const cashQty = available > 0 ? Math.floor(available / price) : Number.MAX_SAFE_INTEGER;
  const exposureQty = exposureRoom > 0 ? Math.floor(exposureRoom / price) : 0;
  const sizedQty = Math.max(0, Math.min(riskQty, cashQty, exposureQty));
  const details = {
    ...baseDetails,
    available,
    exposureRoom,
    maxQtyByRisk: riskQty,
    maxQtyByCash: cashQty,
    maxQtyByExposure: exposureQty,
    finalQty: sizedQty,
    plannedRisk: Math.max(0, sizedQty * riskPerUnit),
  };

  if (riskQty < 1) {
    return {
      qty: 0,
      adjusted: true,
      blocked: `Risk sizing blocked ${symbol}. Risk/share INR ${riskPerUnit.toFixed(2)} exceeds risk/trade INR ${state.riskPerTrade.toFixed(2)}.`,
      message: "",
      details: { ...details, finalQty: 0, plannedRisk: 0 },
    };
  }

  if (sizedQty < 1) {
    return {
      qty: 0,
      adjusted: true,
      blocked: `Risk sizing blocked ${symbol}. Cash or exposure room is not enough for 1 qty.`,
      message: "",
      details,
    };
  }

  return {
    qty: sizedQty,
    adjusted: sizedQty !== fallbackQty,
    message: `Risk sized qty ${sizedQty}. Risk/share INR ${riskPerUnit.toFixed(2)}, planned risk INR ${(sizedQty * riskPerUnit).toFixed(2)}.`,
    details,
  };
}

export async function calculateRiskBasedLotQty(
  symbol: string,
  requestedLots: number,
  lotSize: number,
  price: number,
  state: AutoBotState,
  settings: SettingsState,
  sl?: number,
  options: { maxLots?: number; capRequested?: boolean } = {}
): Promise<PositionSizingResult & { lots: number }> {
  const safeLotSize = Math.max(1, Math.floor(Number(lotSize || 1)));
  const fallbackLots = Math.max(1, Math.floor(Number(requestedLots || 1)));
  const maxLots = Math.max(1, Math.floor(Number(options.maxLots || fallbackLots)));
  const sized = await calculateRiskBasedQty(symbol, fallbackLots * safeLotSize, price, state, settings, sl);
  const withLotDetails = {
    ...sized.details,
    requestedQty: fallbackLots * safeLotSize,
    requestedLots: fallbackLots,
    maxLots,
    lotSize: safeLotSize,
    finalLots: 0,
    riskAllowedLots: 0,
  } as NonNullable<PositionSizingResult["details"]>;

  if (sized.blocked) return { ...sized, lots: 0, details: withLotDetails };

  const riskAllowedLots = Math.floor(sized.qty / safeLotSize);
  const lots = Math.min(riskAllowedLots, maxLots, options.capRequested ? fallbackLots : Number.MAX_SAFE_INTEGER);
  if (lots < 1) {
    return {
      qty: 0,
      lots: 0,
      adjusted: true,
      blocked: `Risk sizing blocked ${symbol}. Sized qty ${sized.qty} is below lot size ${safeLotSize}.`,
      message: "",
      details: { ...withLotDetails, finalQty: 0, finalLots: 0, riskAllowedLots, plannedRisk: 0 },
    };
  }

  const qty = lots * safeLotSize;
  const details = {
    ...withLotDetails,
    finalQty: qty,
    finalLots: lots,
    riskAllowedLots,
    plannedRisk: Math.max(0, qty * Number(withLotDetails.riskPerUnit || 0)),
  };
  return {
    ...sized,
    qty,
    lots,
    adjusted: sized.adjusted || lots !== fallbackLots,
    message: `${sized.message} Rounded to ${lots} lot${lots === 1 ? "" : "s"} / ${qty} qty.`,
    details,
  };
}

export async function evaluatePaperRisk(
  symbol: string,
  qty: number,
  price: number,
  state: AutoBotState,
  settings: SettingsState,
  sl?: number
) {
  const [positions, balance] = await Promise.all([
    api.getPaperPositions().catch(() => []),
    api.getPaperBalance().catch(() => ({})),
  ]);

  const positionRows = openPositionRows(positions);
  const duplicate = positionRows.some((position: any) => {
    const positionSymbol = String(position?.symbol || "");
    const openQty = Math.abs(Number(position?.qty ?? position?.openQty ?? 0));
    return positionSymbol === symbol && openQty > 0;
  });

  if (duplicate) return `[BLOCKED] Open paper position already exists for ${symbol}.`;

  const available = Number((balance as any)?.available ?? 0);
  const netPnl = Number((balance as any)?.netPnl ?? 0);
  const plannedNotional = Math.abs(price * qty);
  const exposure = currentExposure(positionRows);

  if (available > 0 && plannedNotional > available) {
    return `Blocked by cash. Need INR ${plannedNotional.toFixed(2)}, available INR ${available.toFixed(2)}.`;
  }

  if (exposure + plannedNotional > settings.riskMaxExposure) {
    return `Blocked by exposure limit. Exposure would be INR ${(exposure + plannedNotional).toFixed(2)}.`;
  }

  if (netPnl <= -Math.abs(settings.riskMaxDailyLoss)) {
    return `Blocked by daily loss limit. Net P&L is INR ${netPnl.toFixed(2)}.`;
  }

  const stop = Number(sl || 0);
  const plannedRisk = stop > 0 ? Math.abs(price - stop) * qty : Math.min(plannedNotional, state.riskPerTrade);
  if (plannedRisk > state.riskPerTrade) {
    return `Blocked by per-trade risk. Risk INR ${plannedRisk.toFixed(2)} exceeds INR ${state.riskPerTrade.toFixed(2)}.`;
  }

  return null;
}
