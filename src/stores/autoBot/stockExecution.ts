import { api } from "../../lib/api";
import { useMarket } from "../marketStore";
import { useSettings } from "../settingsStore";
import { getCooldownBlock } from "./cooldown";
import { calculateRiskBasedQty, evaluatePaperRisk } from "./risk";
import { readTradeCount, writeTradeCount } from "./storage";
import type { AddDecisionLog, AutoBotState, BotTradeOptions, PlayAlert, SetBotState } from "./types";

type StockExecutionContext = {
  getBot: () => AutoBotState;
  setBot: SetBotState;
  addDecisionLog: AddDecisionLog;
  playAlertIfEnabled: PlayAlert;
};

function stockSizingLogDetails(sizing: Awaited<ReturnType<typeof calculateRiskBasedQty>>) {
  const details = sizing.details;
  return {
    requestedQty: details?.requestedQty ?? sizing.qty,
    finalQty: details?.finalQty ?? sizing.qty,
    riskBudget: details?.riskBudget ?? 0,
    plannedRisk: details?.plannedRisk ?? 0,
    riskPerUnit: details?.riskPerUnit ?? 0,
  };
}

function candleLogDetails(options: BotTradeOptions): Record<string, unknown> {
  if (!options.candlePattern) return {};
  return {
    candle: options.candlePattern,
    candleScore: options.candleScore,
    candleDirection: options.candleDirection,
    candleVolume: options.candleVolumeConfirmed,
    candleTimeframe: options.candleTimeframe,
    marketRegime: options.marketRegime,
  };
}

function candleNote(options: BotTradeOptions) {
  if (!options.candlePattern) return "";
  const score = Number.isFinite(Number(options.candleScore)) ? `${Math.round(Number(options.candleScore))}%` : "--";
  const direction = options.candleDirection || "neutral";
  const volume = options.candleVolumeConfirmed ? "volume" : "no-volume";
  const regime = options.marketRegime ? ` Regime: ${options.marketRegime}.` : "";
  return ` Pattern: ${options.candlePattern} (${score}, ${direction}, ${volume}, ${options.candleTimeframe || "--"}m).${regime}`;
}

export async function triggerStockBotTrade(
  context: StockExecutionContext,
  symbol: string,
  side: "BUY" | "SELL",
  qty: number,
  reason: string,
  options: BotTradeOptions = {}
) {
  const { getBot, setBot, addDecisionLog, playAlertIfEnabled } = context;
  const state = getBot();
  const settings = useSettings.getState();
  const market = useMarket.getState();

  if (!state.enabled || state.paused || settings.killSwitch) return false;
  if (!market.marketOpen) {
    setBot({ lastAction: "Trade blocked. Market is closed." });
    addDecisionLog({
      status: "BLOCKED",
      message: "Trade blocked. Market is closed.",
      symbol,
      side,
      confidence: options.confidence,
      strategy: options.strategy || state.strategy,
      source: options.source,
    });
    return false;
  }

  const latestCount = readTradeCount();
  if (latestCount >= state.maxTradesPerDay) {
    setBot({ tradesExecuted: latestCount, lastAction: `Max daily bot trades (${state.maxTradesPerDay}) reached.` });
    addDecisionLog({
      status: "BLOCKED",
      message: `Max daily bot trades (${state.maxTradesPerDay}) reached.`,
      symbol,
      side,
      confidence: options.confidence,
      strategy: options.strategy || state.strategy,
      source: options.source,
    });
    return false;
  }

  const cooldown = getCooldownBlock({
    symbol,
    side,
    strategy: options.strategy || state.strategy,
  });
  if (cooldown) {
    setBot({ lastAction: cooldown.message });
    addDecisionLog({
      status: "BLOCKED",
      message: cooldown.message,
      symbol,
      side,
      confidence: options.confidence,
      strategy: options.strategy || state.strategy,
      source: options.source,
    });
    return false;
  }

  const tickPrice = Number(useMarket.getState().ticks[symbol]?.ltp || 0);
  const price = Number(options.price || tickPrice || 0);
  if (!symbol || price <= 0 || qty <= 0) {
    setBot({ lastAction: `Trade blocked. No valid live price for ${symbol || "symbol"}.` });
    addDecisionLog({
      status: "BLOCKED",
      message: `No valid live price for ${symbol || "symbol"}.`,
      symbol,
      side,
      confidence: options.confidence,
      strategy: options.strategy || state.strategy,
      source: options.source,
    });
    return false;
  }

  const sizing = await calculateRiskBasedQty(symbol, qty, price, state, settings, options.sl);
  if (sizing.blocked) {
    setBot({ lastAction: sizing.blocked });
    addDecisionLog({
      status: "BLOCKED",
      message: sizing.blocked,
      symbol,
      side,
      confidence: options.confidence,
      strategy: options.strategy || state.strategy,
      source: options.source,
      details: {
        ...stockSizingLogDetails(sizing),
        ...candleLogDetails(options),
      },
    });
    return false;
  }

  const finalQty = sizing.qty;
  if (sizing.message) {
    addDecisionLog({
      status: "CHECK",
      message: sizing.message,
      symbol,
      side,
      confidence: options.confidence,
      strategy: options.strategy || state.strategy,
      source: options.source,
      details: {
        ...stockSizingLogDetails(sizing),
        ...candleLogDetails(options),
      },
    });
  }

  const riskBlock = await evaluatePaperRisk(symbol, finalQty, price, state, settings, options.sl);
  if (riskBlock) {
    setBot({ lastAction: riskBlock });
    addDecisionLog({
      status: "BLOCKED",
      message: riskBlock,
      symbol,
      side,
      confidence: options.confidence,
      strategy: options.strategy || state.strategy,
      source: options.source,
      details: {
        ...stockSizingLogDetails(sizing),
        ...candleLogDetails(options),
      },
    });
    return false;
  }

  if (state.executionMode === "dry_run") {
    const message = `DRY RUN: Would submit ${side} ${finalQty}x ${symbol} at INR ${price.toFixed(2)}. ${reason}`;
    setBot({ lastAction: message });
    addDecisionLog({
      status: "CHECK",
      message,
      symbol,
      side,
      confidence: options.confidence,
      strategy: options.strategy || state.strategy,
      source: options.source,
      details: {
        ...stockSizingLogDetails(sizing),
        ...candleLogDetails(options),
        executionMode: "dry_run",
        entry: price,
        sl: options.sl || 0,
        t1: options.t1 || 0,
        t2: options.t2 || 0,
        qty: finalQty,
      },
    });
    return true;
  }

  setBot({ lastAction: `Submitting ${side} ${finalQty}x ${symbol} from Auto-Bot...` });
  addDecisionLog({
    status: "CHECK",
    message: `Risk passed. Submitting ${side} ${finalQty}x ${symbol}.`,
    symbol,
    side,
    confidence: options.confidence,
    strategy: options.strategy || state.strategy,
    source: options.source,
    details: {
      ...stockSizingLogDetails(sizing),
      ...candleLogDetails(options),
    },
  });

  try {
    const response = await api.placePaperOrder({
      symbol,
      side,
      qty: finalQty,
      orderType: "MARKET",
      price,
      premium: price,
      productType: settings.defaultProduct || "INTRADAY",
      exchange: settings.defaultExchange || "NSE",
      validity: settings.defaultValidity || "DAY",
      signalTime: new Date().toISOString(),
      strategy: options.strategy || state.strategy,
      confidence: options.confidence || state.minConfidence,
      entry: price,
      sl: options.sl || 0,
      t1: options.t1 || 0,
      t2: options.t2 || 0,
      notes: `Auto-Bot ${options.source || "scanner"}: ${reason}.${candleNote(options)}`.trim(),
    });

    if (!response?.ok) {
      setBot({ lastAction: `Auto-Bot order rejected: ${response?.message || "backend did not accept order"}` });
      addDecisionLog({
        status: "ERROR",
        message: `Backend rejected order: ${response?.message || "did not accept order"}.`,
        symbol,
        side,
        confidence: options.confidence,
        strategy: options.strategy || state.strategy,
        source: options.source,
      });
      return false;
    }

    const newCount = latestCount + 1;
    writeTradeCount(newCount);
    playAlertIfEnabled();
    setBot({
      tradesExecuted: newCount,
      lastAction: `[${side}] ${finalQty}x ${symbol} filled by backend at INR ${Number(response.fill || price).toFixed(2)}. Reason: ${reason}`,
    });
    addDecisionLog({
      status: "TRADE",
      message: `Filled at INR ${Number(response.fill || price).toFixed(2)}. ${reason}`,
      symbol,
      side,
      confidence: options.confidence,
      strategy: options.strategy || state.strategy,
      source: options.source,
      details: {
        ...stockSizingLogDetails(sizing),
        ...candleLogDetails(options),
      },
    });
    return true;
  } catch (err: any) {
    setBot({ lastAction: `Auto-Bot order failed: ${err?.message || "backend unavailable"}` });
    addDecisionLog({
      status: "ERROR",
      message: `Order failed: ${err?.message || "backend unavailable"}.`,
      symbol,
      side,
      confidence: options.confidence,
      strategy: options.strategy || state.strategy,
      source: options.source,
    });
    return false;
  }
}
