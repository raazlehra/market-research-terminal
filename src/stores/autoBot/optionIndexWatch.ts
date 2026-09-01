import { api } from "../../lib/api";
import { candlesFromHistoryPayload, evaluateCandlestickPattern, optionSideMatchesPattern } from "../../lib/candlestickPatterns";
import { evaluateChartRules } from "../../lib/chartRules";
import { evaluateExpiryRules } from "../../lib/expiryRules";
import { evaluateOptionLiquidity } from "../../lib/liquidityRules";
import { evaluateMarketRegime } from "../../lib/marketRegime";
import { buildOptionChainSnapshot, OPTION_INDEXES } from "../../lib/optionChainModel";
import { getPatternConfidenceAdjustment } from "../../lib/patternConfidence";
import type { PatternConfidenceAdjustment } from "../../lib/patternConfidence";
import { getCooldownBlock } from "./cooldown";
import { optionWatchBlockDetails, optionWatchSelectionDetails } from "./optionIndexWatchDetails";
import { asRecord, errorMessage, expiryRows, numberOrNull, optionSymbol, type OptionQuote } from "./optionIndexWatchPayload";
import { regimeGuardBlock } from "./regimeGuard";
import { confirmSignalStability } from "./signalStability";
import type { AddDecisionLog, AutoBotState, BotDecisionLog, OptionWatchRow, SetBotState } from "./types";

type SetLastAction = (message: string) => void;

const OPTION_WATCH_STRATEGY = "OPTION_CHAIN_CONFLUENCE";
const ROUTINE_LOG_THROTTLE_MS = 120000;
const lastRoutineLogAt: Record<string, number> = {};

type OptionIndexInfo = (typeof OPTION_INDEXES)[number];

function shouldLogRoutine(key: string) {
  const now = Date.now();
  if (now - (lastRoutineLogAt[key] || 0) < ROUTINE_LOG_THROTTLE_MS) return false;
  lastRoutineLogAt[key] = now;
  return true;
}

function clampConfidence(value: number) {
  return Math.max(0, Math.min(100, value));
}

function expiryYears(expiry?: string) {
  if (!expiry) return 30 / 365;
  const normalized = expiry.trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? new Date(`${normalized}T23:59:59`)
    : new Date(normalized);
  const millis = date.getTime() - Date.now();
  return Math.max(millis / (365 * 24 * 60 * 60 * 1000), 0.001);
}

function directionMatches(optionSide: "CE" | "PE", bias: string) {
  return (optionSide === "CE" && bias === "Bullish") || (optionSide === "PE" && bias === "Bearish");
}

function logBlocked(addDecisionLog: AddDecisionLog, message: string, extra?: Partial<Omit<BotDecisionLog, "id" | "time" | "message" | "status">>) {
  addDecisionLog({
    status: "SKIP",
    message,
    strategy: OPTION_WATCH_STRATEGY,
    source: "option_chain",
    ...extra,
  });
}

function watchRowBase(indexInfo: OptionIndexInfo): Pick<OptionWatchRow, "index" | "label"> {
  return {
    index: String(indexInfo.value || indexInfo.label || ""),
    label: String(indexInfo.label || indexInfo.value || ""),
  };
}

async function evaluateIndexCandle(bot: AutoBotState, indexSymbol: string, resolution: string, optionSide: "CE" | "PE") {
  if (bot.candleConfirmationMode === "off" && !bot.regimeGuardEnabled) {
    const signal = evaluateCandlestickPattern([]);
    const regime = evaluateMarketRegime([]);
    return { signal, regime, aligned: true, usable: false, blocked: false };
  }

  const history = await api.history(indexSymbol, resolution, resolution === "60" ? 30 : 7);
  const candles = candlesFromHistoryPayload(history);
  const signal = evaluateCandlestickPattern(candles);
  const regime = evaluateMarketRegime(candles);
  const usable = signal.direction !== "neutral"
    && signal.score >= bot.minCandleScore
    && (!bot.requireCandleVolume || signal.confirmed);
  return {
    signal,
    regime,
    aligned: optionSideMatchesPattern(optionSide, signal),
    usable,
    blocked: bot.candleConfirmationMode === "block_opposite" && usable && !optionSideMatchesPattern(optionSide, signal),
  };
}

type OptionWatchCandidate = {
  indexInfo: OptionIndexInfo;
  symbol: string;
  optionSide: "CE" | "PE";
  selectedExpiry?: string;
  selectedExpiryLabel?: string;
  option?: OptionQuote;
  snapshot: ReturnType<typeof buildOptionChainSnapshot>;
  adjustedConfluence: number;
  patternAdjustment: Pick<PatternConfidenceAdjustment, "adjustment" | "sample">;
  score: number;
  candleRule: Awaited<ReturnType<typeof evaluateIndexCandle>>;
  spot: number;
  data: Record<string, unknown>;
};

export async function runOptionIndexWatchOnce(
  getBot: () => AutoBotState,
  addDecisionLog: AddDecisionLog,
  watchInFlightRef: { current: boolean },
  setLastAction?: SetLastAction,
  setBot?: SetBotState
) {
  const bot = getBot();
  if (!bot.enabled || bot.paused || !bot.optionIndexWatchEnabled || watchInFlightRef.current) return;

  watchInFlightRef.current = true;
  try {
    const candidates: OptionWatchCandidate[] = [];
    const blockedMessages: string[] = [];
    const watchRows: OptionWatchRow[] = [];

    for (const indexInfo of OPTION_INDEXES) {
      try {
        const indexRisk = bot.optionIndexRisk[indexInfo.label] || { enabled: true, requestedLots: 1, maxLots: 1 };
        if (!indexRisk.enabled) {
          blockedMessages.push(`${indexInfo.label}: disabled`);
          watchRows.push({
            ...watchRowBase(indexInfo),
            status: "BLOCKED",
            reason: "Disabled in bot settings",
          });
          continue;
        }

        const expiries = expiryRows(await api.getExpiries(indexInfo.value));
        const selectedExpiry = expiries[0]?.expiry;
        const selectedExpiryLabel = expiries[0]?.date;
        const data = asRecord(await api.getOptionChain(indexInfo.value, selectedExpiry));
        const rows = Array.isArray(data.chain) ? data.chain : [];
        const spot = Number(data.spot || 0);
        const snapshot = buildOptionChainSnapshot({
          data,
          rows,
          spot,
          timeToExpiryYears: expiryYears(selectedExpiry),
        });
        const recommendation = snapshot.recommendedOption;
        const optionSide = recommendation?.side as "CE" | "PE" | undefined;
        const option = recommendation?.option as OptionQuote | undefined;
        const symbol = optionSymbol(option, recommendation?.row);
        const entry = Number(snapshot.recommendedEntryPrice || 0);
        const baseRow = {
          ...watchRowBase(indexInfo),
          symbol,
          optionSide,
          strike: recommendation?.row?.strike,
          bias: snapshot.bias,
          confluence: snapshot.confluenceScore,
          recommendationScore: Number(recommendation?.score || 0),
        };

        if (!recommendation || !optionSide || !symbol || entry <= 0) {
          blockedMessages.push(`${indexInfo.label}: no option recommendation`);
          watchRows.push({
            ...watchRowBase(indexInfo),
            status: "BLOCKED",
            reason: "No option recommendation",
          });
          continue;
        }

        const expiryRule = evaluateExpiryRules({
          expiry: selectedExpiry,
          expiryLabel: selectedExpiryLabel,
          bid: option?.bid,
          ask: option?.ask,
          ltp: entry,
          volume: option?.volume,
          oi: option?.oi,
          confidence: snapshot.confluenceScore,
          side: optionSide,
          bias: snapshot.bias,
        });
        const liquidityRule = evaluateOptionLiquidity({
          bid: option?.bid,
          ask: option?.ask,
          ltp: entry,
          volume: option?.volume,
          oi: option?.oi,
        });
        const chartRule = evaluateChartRules({
          side: optionSide,
          spot,
          vwap: snapshot.vwap,
          ema20: snapshot.ema20,
          ema50: snapshot.ema50,
          vwap15: numberOrNull(data.vwap15),
          ema2015: numberOrNull(data.ema2015),
          ema5015: numberOrNull(data.ema5015),
          vwap60: numberOrNull(data.vwap60),
          ema2060: numberOrNull(data.ema2060),
          ema5060: numberOrNull(data.ema5060),
          support: snapshot.s1,
          resistance: snapshot.r1,
        });
        const candleRule = await evaluateIndexCandle(bot, indexInfo.value, bot.timeframe, optionSide);
        const regimeBlock = regimeGuardBlock(bot, candleRule);
        const patternAdjustment = bot.adaptivePatternConfidenceEnabled && candleRule.usable
          ? await getPatternConfidenceAdjustment(
              candleRule.signal.name,
              getBot().decisionLog,
              bot.maxPatternConfidenceAdjustment,
              candleRule.regime.regime
            )
          : { adjustment: 0, sample: 0, winRate: null, avgR: null, reason: "Adaptive pattern confidence disabled." };
        const adjustedConfluence = clampConfidence(snapshot.confluenceScore + patternAdjustment.adjustment);
        const cooldown = getCooldownBlock({ symbol, side: "BUY", strategy: OPTION_WATCH_STRATEGY });
        const finalScore = adjustedConfluence + Number(recommendation.score || 0) + liquidityRule.score + expiryRule.score + chartRule.score;
        const blockers = [
          adjustedConfluence < bot.minConfidence ? `confluence ${Math.round(adjustedConfluence)}% < ${bot.minConfidence}%` : "",
          !liquidityRule.tradeable ? `liquidity ${liquidityRule.label}` : "",
          !expiryRule.tradeable ? `expiry ${expiryRule.label}` : "",
          !chartRule.tradeable ? `chart ${chartRule.label}` : "",
          candleRule.blocked ? `candle ${candleRule.signal.name} opposes ${optionSide}` : "",
          regimeBlock,
          !directionMatches(optionSide, snapshot.bias) ? `bias ${snapshot.bias} vs ${optionSide}` : "",
          cooldown ? "cooldown active" : "",
        ].filter(Boolean);

        if (blockers.length) {
          blockedMessages.push(`${indexInfo.label}: ${blockers[0]}`);
          watchRows.push({
            ...baseRow,
            confluence: adjustedConfluence,
            liquidityScore: liquidityRule.score,
            expiryScore: expiryRule.score,
            chartScore: chartRule.score,
            finalScore,
            status: "BLOCKED",
            reason: blockers[0],
          });
          if (shouldLogRoutine(`watch_block_${indexInfo.label}_${blockers[0]}`)) {
            logBlocked(addDecisionLog, `${indexInfo.label} skipped: ${blockers[0]}.`, {
              symbol,
              side: "BUY",
              confidence: adjustedConfluence,
              details: optionWatchBlockDetails({
                optionSide,
                finalScore,
                liquidityScore: liquidityRule.score,
                expiryScore: expiryRule.score,
                chartScore: chartRule.score,
                candleRule,
                regimeBlock,
                regimeGuardMinScore: bot.regimeGuardMinCandleScore,
                patternAdjustment,
                confidenceBefore: snapshot.confluenceScore,
                confidenceAfter: adjustedConfluence,
                entry,
                sl: snapshot.recommendedSL,
                t1: snapshot.recommendedT1,
                t2: snapshot.recommendedT2,
                qty: Math.max(1, Math.floor(Number(indexRisk.requestedLots || 1))) * Number(indexInfo.lot || 1),
                timeframe: bot.timeframe,
              }),
            });
          }
          continue;
        }

        watchRows.push({
          ...baseRow,
          confluence: adjustedConfluence,
          liquidityScore: liquidityRule.score,
          expiryScore: expiryRule.score,
          chartScore: chartRule.score,
          finalScore,
          status: "READY",
          reason: candleRule.usable && patternAdjustment.adjustment
            ? `Candidate / ${candleRule.signal.name} ${patternAdjustment.adjustment > 0 ? "+" : ""}${patternAdjustment.adjustment}`
            : candleRule.usable ? `Candidate / ${candleRule.signal.name}` : "Candidate",
        });
        candidates.push({
          indexInfo,
          symbol,
          optionSide,
          selectedExpiry,
          selectedExpiryLabel,
          option,
          snapshot,
          adjustedConfluence,
          patternAdjustment,
          score: finalScore,
          candleRule,
          spot,
          data,
        });
      } catch (err: unknown) {
        const message = errorMessage(err, "watch failed");
        blockedMessages.push(`${indexInfo.label}: ${message}`);
        watchRows.push({
          ...watchRowBase(indexInfo),
          status: "ERROR",
          reason: message,
        });
      }
    }

    setBot?.({ optionWatchRows: watchRows.sort((a, b) => Number(b.finalScore || 0) - Number(a.finalScore || 0)) });
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best) {
      const summary = blockedMessages.slice(0, 3).join(" | ") || "No valid index option setup.";
      setLastAction?.(`Option watch waiting. ${summary}`);
      if (shouldLogRoutine(`watch_none_${summary}`)) {
        logBlocked(addDecisionLog, `Option watch checked ${OPTION_INDEXES.length} indices. ${summary}`);
      }
      return;
    }
    const bestRecommendation = best.snapshot.recommendedOption;
    if (!bestRecommendation) {
      setLastAction?.("Option watch waiting. The selected setup no longer has a directional candidate.");
      return;
    }

    const stabilityKey = `option_watch_${best.indexInfo.label}_${best.symbol}_${best.optionSide}_${bestRecommendation.row?.strike}`;
    const stability = confirmSignalStability({
      key: stabilityKey,
      label: `${best.indexInfo.label} ${best.optionSide} ${bestRecommendation.row?.strike}`,
    });
    if (!stability.stable) {
      setLastAction?.(`Option watch waiting. ${stability.message}`);
      addDecisionLog({
        status: "CHECK",
        message: stability.message,
        symbol: best.symbol,
        side: "BUY",
        confidence: best.adjustedConfluence,
        strategy: OPTION_WATCH_STRATEGY,
        source: "option_chain",
      });
      return;
    }

    setLastAction?.(`Option watch selected ${best.indexInfo.label} ${best.optionSide} ${bestRecommendation.row?.strike}.`);
    const runnerUp = candidates[1];
    addDecisionLog({
      status: "CHECK",
      message: runnerUp
        ? `Option watch selected ${best.indexInfo.label} ${best.optionSide} ${bestRecommendation.row?.strike} score ${Math.round(best.score)}. Next: ${runnerUp.indexInfo.label} score ${Math.round(runnerUp.score)}.`
        : `Option watch selected ${best.indexInfo.label} ${best.optionSide} ${bestRecommendation.row?.strike}, score ${Math.round(best.score)}.`,
      symbol: best.symbol,
      side: "BUY",
      confidence: best.adjustedConfluence,
      strategy: OPTION_WATCH_STRATEGY,
      source: "option_chain",
      details: optionWatchSelectionDetails(best, runnerUp, bot),
    });

    await getBot().triggerOptionChainTrade({
      symbol: best.symbol,
      optionSide: best.optionSide,
      lotSize: best.indexInfo.lot,
      requestedLots: Math.max(1, Math.floor(Number(bot.optionIndexRisk[best.indexInfo.label]?.requestedLots || 1))),
      maxLots: Math.max(1, Math.floor(Number(bot.optionIndexRisk[best.indexInfo.label]?.maxLots || 1))),
      sizingMode: bot.optionSizingMode,
      price: best.snapshot.recommendedEntryPrice,
      sl: best.snapshot.recommendedSL,
      t1: best.snapshot.recommendedT1,
      t2: best.snapshot.recommendedT2,
      confidence: best.adjustedConfluence,
      bias: best.snapshot.bias,
      strike: bestRecommendation.row?.strike,
      expiry: best.selectedExpiry,
      expiryLabel: best.selectedExpiryLabel,
      bid: best.option?.bid,
      ask: best.option?.ask,
      volume: best.option?.volume,
      oi: best.option?.oi,
      spot: best.spot,
      vwap: best.snapshot.vwap,
      ema20: best.snapshot.ema20,
      ema50: best.snapshot.ema50,
      vwap15: numberOrNull(best.data.vwap15),
      ema2015: numberOrNull(best.data.ema2015),
      ema5015: numberOrNull(best.data.ema5015),
      vwap60: numberOrNull(best.data.vwap60),
      ema2060: numberOrNull(best.data.ema2060),
      ema5060: numberOrNull(best.data.ema5060),
      support: best.snapshot.s1,
      resistance: best.snapshot.r1,
      ...(best.candleRule.usable ? {
        candlePattern: best.candleRule.signal.name,
        candleDirection: best.candleRule.signal.direction,
        candleScore: best.candleRule.signal.score,
        candleEntry: best.candleRule.signal.entry,
        candleSl: best.candleRule.signal.sl,
        candleVolumeConfirmed: best.candleRule.signal.confirmed,
        candleTimeframe: bot.timeframe,
        marketRegime: best.candleRule.regime.regime,
      } : {}),
    });
  } catch (err: unknown) {
    const message = errorMessage(err, "unable to scan index options");
    setLastAction?.(`Option watch error: ${message}.`);
    addDecisionLog({
      status: "ERROR",
      message: `Option watch error: ${message}.`,
      strategy: OPTION_WATCH_STRATEGY,
      source: "option_chain",
    });
  } finally {
    watchInFlightRef.current = false;
  }
}
