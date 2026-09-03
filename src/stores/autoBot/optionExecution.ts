import { api } from "../../lib/api";
import { evaluateChartRules } from "../../lib/chartRules";
import { evaluateExpiryRules } from "../../lib/expiryRules";
import { evaluateOptionLiquidity } from "../../lib/liquidityRules";
import { useMarket } from "../marketStore";
import { useSettings } from "../settingsStore";
import { getCooldownBlock } from "./cooldown";
import { applyFixedSizingBlock, buildSizingSnapshot, candleNote, optionExecutionLogDetails, optionSizingLogDetails } from "./optionSizingDetails";
import { calculateRiskBasedLotQty, evaluatePaperRisk } from "./risk";
import { readTradeCount, writeTradeCount } from "./storage";
import type { AddDecisionLog, AutoBotState, OptionChainTradeOptions, PlayAlert, SetBotState } from "./types";

type OptionExecutionContext = {
  getBot: () => AutoBotState;
  setBot: SetBotState;
  addDecisionLog: AddDecisionLog;
  playAlertIfEnabled: PlayAlert;
};

export async function triggerOptionBotTrade(context: OptionExecutionContext, options: OptionChainTradeOptions) {
  const { getBot, setBot, addDecisionLog, playAlertIfEnabled } = context;
  const state = getBot();
  const settings = useSettings.getState();
  const market = useMarket.getState();
  const symbol = String(options.symbol || "");
  const optionSide = options.optionSide;
  const confidence = Number(options.confidence || 0);
  const strategy = "OPTION_CHAIN_CONFLUENCE";

  if (settings.killSwitch) {
    const message = "Option Auto-Bot blocked. Kill switch is active.";
    setBot({ lastAction: message });
    addDecisionLog({
      status: "BLOCKED",
      message,
      symbol,
      side: "BUY",
      confidence,
      strategy,
      source: "option_chain",
    });
    return false;
  }

  if (!market.marketOpen) {
    setBot({ lastAction: "Option Auto-Bot blocked. Market is closed." });
    addDecisionLog({
      status: "BLOCKED",
      message: "Option Auto-Bot blocked. Market is closed.",
      symbol,
      side: "BUY",
      confidence,
      strategy,
      source: "option_chain",
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
      side: "BUY",
      confidence,
      strategy,
      source: "option_chain",
    });
    return false;
  }

  const cooldown = getCooldownBlock({
    symbol,
    side: "BUY",
    strategy,
  });
  if (cooldown) {
    setBot({ lastAction: cooldown.message });
    addDecisionLog({
      status: "BLOCKED",
      message: cooldown.message,
      symbol,
      side: "BUY",
      confidence,
      strategy,
      source: "option_chain",
    });
    return false;
  }

  if (!symbol || options.price <= 0 || options.sl <= 0 || options.t1 <= 0 || options.t2 <= 0 || options.lotSize <= 0) {
    setBot({ lastAction: "Option Auto-Bot blocked. Recommendation is incomplete." });
    addDecisionLog({
      status: "BLOCKED",
      message: "Option recommendation is incomplete. Symbol, entry, SL, targets, and lot size are required.",
      symbol,
      side: "BUY",
      confidence,
      strategy,
      source: "option_chain",
    });
    return false;
  }

  const liquidityRule = evaluateOptionLiquidity({
    bid: options.bid,
    ask: options.ask,
    ltp: options.price,
    volume: options.volume,
    oi: options.oi,
  });
  if (!liquidityRule.tradeable) {
    const message = `Option Auto-Bot blocked. ${liquidityRule.label}: ${liquidityRule.reasons[0] || "liquidity rules failed"}`;
    setBot({ lastAction: message });
    addDecisionLog({
      status: "BLOCKED",
      message,
      symbol,
      side: "BUY",
      confidence,
      strategy,
      source: "option_chain",
    });
    return false;
  }

  if (confidence < state.minConfidence) {
    setBot({ lastAction: `Option Auto-Bot blocked. Confluence score ${confidence}/100 is below ${state.minConfidence}/100.` });
    addDecisionLog({
      status: "BLOCKED",
      message: `Confluence score ${confidence}/100 is below minimum ${state.minConfidence}/100.`,
      symbol,
      side: "BUY",
      confidence,
      strategy,
      source: "option_chain",
    });
    return false;
  }

  const expiryRule = evaluateExpiryRules({
    expiry: options.expiry,
    expiryLabel: options.expiryLabel,
    bid: options.bid,
    ask: options.ask,
    ltp: options.price,
    volume: options.volume,
    oi: options.oi,
    confidence,
    side: optionSide,
    bias: options.bias,
  });
  if (!expiryRule.tradeable) {
    const message = `Option Auto-Bot blocked. ${expiryRule.label}: ${expiryRule.reasons[0] || "expiry rules failed"}`;
    setBot({ lastAction: message });
    addDecisionLog({
      status: "BLOCKED",
      message,
      symbol,
      side: "BUY",
      confidence,
      strategy,
      source: "option_chain",
    });
    return false;
  }

  const chartRule = evaluateChartRules({
    side: optionSide,
    spot: options.spot,
    vwap: options.vwap,
    ema20: options.ema20,
    ema50: options.ema50,
    vwap15: options.vwap15,
    ema2015: options.ema2015,
    ema5015: options.ema5015,
    vwap60: options.vwap60,
    ema2060: options.ema2060,
    ema5060: options.ema5060,
    support: options.support,
    resistance: options.resistance,
  });
  if (!chartRule.tradeable) {
    const message = `Option Auto-Bot blocked. ${chartRule.reasons[0] || "chart confirmation failed"}`;
    setBot({ lastAction: message });
    addDecisionLog({
      status: "BLOCKED",
      message,
      symbol,
      side: "BUY",
      confidence,
      strategy,
      source: "option_chain",
    });
    return false;
  }

  const bias = String(options.bias || "Neutral");
  const directionMismatch = (optionSide === "CE" && bias !== "Bullish") || (optionSide === "PE" && bias !== "Bearish");
  if (directionMismatch) {
    setBot({ lastAction: `Option Auto-Bot blocked. ${optionSide} does not match ${bias} bias.` });
    addDecisionLog({
      status: "BLOCKED",
      message: `${optionSide} does not match ${bias} option-chain bias.`,
      symbol,
      side: "BUY",
      confidence,
      strategy,
      source: "option_chain",
    });
    return false;
  }

  let sizing: Awaited<ReturnType<typeof calculateRiskBasedLotQty>>;
  try {
    const sizingMode = options.sizingMode || state.optionSizingMode || "smaller";
    const requestedLots = Math.max(1, Math.floor(Number(options.requestedLots || 1)));
    const maxLots = Math.max(requestedLots, Math.floor(Number(options.maxLots || requestedLots)));
    sizing = await calculateRiskBasedLotQty(
      symbol,
      requestedLots,
      options.lotSize,
      options.price,
      state,
      settings,
      options.sl,
      {
        maxLots,
        capRequested: sizingMode !== "risk",
      }
    );

    if (sizingMode === "fixed") sizing = applyFixedSizingBlock(symbol, requestedLots, sizing);
  } catch (err: any) {
    const message = `Option Auto-Bot sizing failed: ${err?.message || "backend unavailable"}.`;
    setBot({ lastAction: message });
    addDecisionLog({
      status: "ERROR",
      message,
      symbol,
      side: "BUY",
      confidence,
      strategy,
      source: "option_chain",
    });
    return false;
  }

  if (sizing.blocked) {
    setBot({ lastAction: sizing.blocked, lastOptionSizing: buildSizingSnapshot(options, sizing, sizing.blocked) });
    addDecisionLog({
      status: "BLOCKED",
      message: sizing.blocked,
      symbol,
      side: "BUY",
      confidence,
      strategy,
      source: "option_chain",
      details: optionSizingLogDetails(options, sizing),
    });
    return false;
  }

  setBot({ lastOptionSizing: buildSizingSnapshot(options, sizing) });
  addDecisionLog({
    status: "CHECK",
    message: sizing.message,
    symbol,
    side: "BUY",
    confidence,
    strategy,
    source: "option_chain",
    details: optionSizingLogDetails(options, sizing),
  });

  let riskBlock: string | null;
  try {
    riskBlock = await evaluatePaperRisk(symbol, sizing.qty, options.price, state, settings, options.sl);
  } catch (err: any) {
    const message = `Option Auto-Bot risk check failed: ${err?.message || "backend unavailable"}.`;
    setBot({ lastAction: message });
    addDecisionLog({
      status: "ERROR",
      message,
      symbol,
      side: "BUY",
      confidence,
      strategy,
      source: "option_chain",
    });
    return false;
  }

  if (riskBlock) {
    setBot({ lastAction: riskBlock, lastOptionSizing: buildSizingSnapshot(options, sizing, riskBlock) });
    addDecisionLog({
      status: "BLOCKED",
      message: riskBlock,
      symbol,
      side: "BUY",
      confidence,
      strategy,
      source: "option_chain",
      details: optionSizingLogDetails(options, sizing),
    });
    return false;
  }

  if (state.executionMode === "dry_run") {
    const message = `DRY RUN: Would submit BUY ${sizing.lots} lot(s) ${symbol} at INR ${options.price.toFixed(2)}.`;
    setBot({ lastAction: message, lastOptionSizing: buildSizingSnapshot(options, sizing) });
    addDecisionLog({
      status: "CHECK",
      message,
      symbol,
      side: "BUY",
      confidence,
      strategy,
      source: "option_chain",
      details: optionExecutionLogDetails(options, sizing, "dry_run"),
    });
    return true;
  }

  setBot({ lastAction: `Submitting Option Auto-Bot BUY ${sizing.lots} lot(s) ${symbol}...`, lastOptionSizing: buildSizingSnapshot(options, sizing) });
  try {
    const response = await api.placePaperOrder({
      symbol,
      side: "BUY",
      qty: sizing.qty,
      orderType: "MARKET",
      price: options.price,
      premium: options.price,
      productType: settings.defaultProduct || "INTRADAY",
      exchange: settings.defaultExchange || "NSE",
      validity: settings.defaultValidity || "DAY",
      signalTime: new Date().toISOString(),
      strategy,
      confidence,
      entry: options.price,
      sl: options.sl,
      t1: options.t1,
      t2: options.t2,
      notes: `Option Auto-Bot ${optionSide} ${options.strike || ""} ${options.expiry || ""}.${candleNote(options)}`.trim(),
    });

    if (!response?.ok) {
      const message = `Option Auto-Bot order rejected: ${response?.message || "backend did not accept order"}`;
      setBot({ lastAction: message, lastOptionSizing: buildSizingSnapshot(options, sizing, message) });
      addDecisionLog({
        status: "ERROR",
        message: `Backend rejected option order: ${response?.message || "did not accept order"}.`,
        symbol,
        side: "BUY",
        confidence,
        strategy,
        source: "option_chain",
      });
      return false;
    }

    const newCount = latestCount + 1;
    writeTradeCount(newCount);
    playAlertIfEnabled();
    setBot({
      tradesExecuted: newCount,
      lastAction: `[OPTION ${optionSide}] ${sizing.lots} lot(s) ${symbol} filled at INR ${Number(response.fill || options.price).toFixed(2)}.`,
      lastOptionSizing: buildSizingSnapshot(options, sizing),
    });
    addDecisionLog({
      status: "TRADE",
      message: `Option ${optionSide} filled: ${sizing.lots} lot(s) / ${sizing.qty} qty at INR ${Number(response.fill || options.price).toFixed(2)}.`,
      symbol,
      side: "BUY",
      confidence,
      strategy,
      source: "option_chain",
      details: optionSizingLogDetails(options, sizing),
    });
    return true;
  } catch (err: any) {
    const message = `Option Auto-Bot order failed: ${err?.message || "backend unavailable"}`;
    setBot({ lastAction: message, lastOptionSizing: buildSizingSnapshot(options, sizing, message) });
    addDecisionLog({
      status: "ERROR",
      message: `Option order failed: ${err?.message || "backend unavailable"}.`,
      symbol,
      side: "BUY",
      confidence,
      strategy,
      source: "option_chain",
    });
    return false;
  }
}
