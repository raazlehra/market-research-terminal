import { api } from "../../lib/api";
import { candlesFromHistoryPayload, evaluateCandlestickPattern, optionSideMatchesPattern } from "../../lib/candlestickPatterns";
import { evaluateMarketRegime } from "../../lib/marketRegime";
import { getPatternConfidenceAdjustment } from "../../lib/patternConfidence";
import { useMarket } from "../marketStore";
import { useSettings } from "../settingsStore";
import type { AutoBotState, BotDecisionLog, CandlePatternContext } from "./types";
import { localDayKey } from "./storage";
import { evaluateScannerQuality, numberValue } from "./quality";
import { confirmSignalStability } from "./signalStability";

type AddDecisionLog = (entry: Omit<BotDecisionLog, "id" | "time">) => void;
type SetLastAction = (message: string) => void;

const ROUTINE_LOG_THROTTLE_MS = 60000;
const lastRoutineLogAt: Record<string, number> = {};

function shouldLogRoutine(key: string) {
  const now = Date.now();
  if (now - (lastRoutineLogAt[key] || 0) < ROUTINE_LOG_THROTTLE_MS) return false;
  lastRoutineLogAt[key] = now;
  return true;
}

async function evaluateScannerCandle(symbol: string, resolution: string, side: "BUY" | "SELL") {
  const history = await api.history(symbol, resolution, resolution === "60" ? 30 : 7);
  const candles = candlesFromHistoryPayload(history);
  const signal = evaluateCandlestickPattern(candles);
  const regime = evaluateMarketRegime(candles);
  return {
    signal,
    regime,
    aligned: optionSideMatchesPattern(side, signal),
  };
}

function candleIsUsable(bot: AutoBotState, signal: Awaited<ReturnType<typeof evaluateScannerCandle>>["signal"]) {
  return signal.direction !== "neutral"
    && signal.score >= bot.minCandleScore
    && (!bot.requireCandleVolume || signal.confirmed);
}

function clampConfidence(value: number) {
  return Math.max(0, Math.min(100, value));
}

export async function runScannerOnce(
  getBot: () => AutoBotState,
  addDecisionLog: AddDecisionLog,
  scanInFlightRef: { current: boolean },
  setLastAction?: SetLastAction
) {
  const bot = getBot();
  const settings = useSettings.getState();
  if (!bot.enabled || bot.paused || settings.killSwitch || scanInFlightRef.current) return;
  if (!useMarket.getState().marketOpen) {
    setLastAction?.("Auto-Bot waiting. Market is closed.");
    if (shouldLogRoutine("market_closed")) {
      addDecisionLog({
        status: "SKIP",
        message: "Scanner skipped. Market is closed.",
        strategy: bot.strategy,
        source: "scanner",
      });
    }
    return;
  }

  scanInFlightRef.current = true;
  try {
    const scanKey = `${bot.strategy}_${bot.universe}_${bot.timeframe}`;
    if (shouldLogRoutine(`check_${scanKey}`)) {
      addDecisionLog({
        status: "CHECK",
        message: `Scanning every 15s. Waiting for ${bot.strategy} on ${bot.universe} / ${bot.timeframe}m.`,
        strategy: bot.strategy,
        source: "scanner",
      });
    }

    const scan = await api.scan({
      type: bot.strategy,
      params: {
        universe: bot.universe,
        resolution: bot.timeframe,
        scanId: Date.now(),
      },
    });

    const results = Array.isArray(scan?.results) ? scan.results : [];
    const candidates = results
      .filter((row: any) => Number(row?.confidence || 0) >= bot.minConfidence)
      .sort((a: any, b: any) => Number(b?.confidence || 0) - Number(a?.confidence || 0));
    let candidate: any = null;
    let candidateQuality: ReturnType<typeof evaluateScannerQuality> | null = null;

    if (!candidates.length) {
      setLastAction?.(`Auto-Bot scanning every 15s. Waiting for signal score above ${bot.minConfidence}/100.`);
      if (shouldLogRoutine(`no_signal_${scanKey}_${bot.minConfidence}`)) {
        addDecisionLog({
          status: "SKIP",
          message: `No scanner signal above ${bot.minConfidence}/100. Bot remains active and waiting.`,
          strategy: bot.strategy,
          source: "scanner",
          details: {
            results: results.length,
            threshold: bot.minConfidence,
          },
        });
      }
      return;
    }

    for (const row of candidates) {
      const side = row.side === "SELL" ? "SELL" : "BUY";
      const quality = evaluateScannerQuality(row, side, bot.minT1RewardRisk, bot.minT2RewardRisk);
      if (quality.ok) {
        candidate = row;
        candidateQuality = quality;
        break;
      }

      if (!candidateQuality) candidateQuality = quality;
    }

    if (!candidate) {
      const top = candidates[0] || {};
      const message = candidateQuality?.message || "Quality gate blocked scanner signal.";
      setLastAction?.(message);
      if (shouldLogRoutine(`quality_${scanKey}_${String(top.symbol || "")}_${message}`)) {
        addDecisionLog({
          status: "SKIP",
          message,
          symbol: String(top.symbol || ""),
          side: top.side === "SELL" ? "SELL" : "BUY",
          confidence: Number(top.confidence || 0),
          strategy: bot.strategy,
          source: "scanner",
          details: candidateQuality ? {
            rr1: Number(candidateQuality.rr1.toFixed(2)),
            rr2: Number(candidateQuality.rr2.toFixed(2)),
            factors: candidateQuality.factorCount,
          } : undefined,
        });
      }
      return;
    }

    const symbol = String(candidate.symbol || "");
    const side = candidate.side === "SELL" ? "SELL" : "BUY";
    const qty = Math.max(1, Number(settings.defaultQty || 1));
    const firedKey = `bot_scan_fired_${localDayKey()}_${bot.strategy}_${symbol}`;

    if (!symbol) {
      addDecisionLog({
        status: "SKIP",
        message: "Scanner candidate skipped. Missing symbol.",
        confidence: Number(candidate.confidence || 0),
        strategy: bot.strategy,
        source: "scanner",
      });
      return;
    }

    if (sessionStorage.getItem(firedKey)) {
      setLastAction?.(`${symbol} already fired today for ${bot.strategy}.`);
      if (shouldLogRoutine(`fired_${firedKey}`)) {
        addDecisionLog({
          status: "SKIP",
          message: `Scanner signal skipped. ${symbol} already fired today for ${bot.strategy}.`,
          symbol,
          side,
          confidence: Number(candidate.confidence || 0),
          strategy: bot.strategy,
          source: "scanner",
        });
      }
      return;
    }

    if (candidateQuality) {
      addDecisionLog({
        status: "CHECK",
        message: candidateQuality.message,
        symbol,
        side,
        confidence: Number(candidate.confidence || 0),
        strategy: bot.strategy,
        source: "scanner",
        details: {
          rr1: Number(candidateQuality.rr1.toFixed(2)),
          rr2: Number(candidateQuality.rr2.toFixed(2)),
          factors: candidateQuality.factorCount,
          candidates: candidates.length,
        },
      });
    }

    let candlePatternContext: CandlePatternContext = {};
    let adjustedConfidence = Number(candidate.confidence || 0);
    if (bot.candleConfirmationMode !== "off") {
      try {
        const candle = await evaluateScannerCandle(symbol, bot.timeframe, side);
        const usableCandle = candleIsUsable(bot, candle.signal);
        const blockedByCandle = bot.candleConfirmationMode === "block_opposite" && usableCandle && !candle.aligned;
        if (usableCandle) {
          candlePatternContext = {
            candlePattern: candle.signal.name,
            candleDirection: candle.signal.direction,
            candleScore: candle.signal.score,
            candleEntry: candle.signal.entry,
            candleSl: candle.signal.sl,
            candleVolumeConfirmed: candle.signal.confirmed,
            candleTimeframe: bot.timeframe,
            marketRegime: candle.regime.regime,
          };
        }

        if (blockedByCandle) {
          const message = `Candle confirmation blocked ${symbol}. ${candle.signal.name} opposes ${side}.`;
          setLastAction?.(message);
          addDecisionLog({
            status: "BLOCKED",
            message,
            symbol,
            side,
            confidence: Number(candidate.confidence || 0),
            strategy: bot.strategy,
            source: "scanner",
            details: {
              candle: candle.signal.name,
              candleScore: candle.signal.score,
              candleEntry: candle.signal.entry,
              candleSl: candle.signal.sl,
              candleVolume: candle.signal.confirmed,
              marketRegime: candle.regime.regime,
              regimeTrend: candle.regime.trendPct,
              regimeRange: candle.regime.rangePct,
            },
          });
          return;
        }

        if (usableCandle) {
          addDecisionLog({
            status: "CHECK",
            message: candle.aligned
              ? `Candle confirmation passed: ${candle.signal.name}.`
              : `Candle signal noted: ${candle.signal.name}.`,
            symbol,
            side,
            confidence: Number(candidate.confidence || 0),
            strategy: bot.strategy,
            source: "scanner",
            details: {
              candle: candle.signal.name,
              candleScore: candle.signal.score,
              candleEntry: candle.signal.entry,
              candleSl: candle.signal.sl,
              candleVolume: candle.signal.confirmed,
              marketRegime: candle.regime.regime,
              regimeTrend: candle.regime.trendPct,
              regimeRange: candle.regime.rangePct,
            },
          });

          if (bot.adaptivePatternConfidenceEnabled) {
            const patternAdjustment = await getPatternConfidenceAdjustment(
              candle.signal.name,
              getBot().decisionLog,
              bot.maxPatternConfidenceAdjustment,
              candle.regime.regime
            );
            adjustedConfidence = clampConfidence(adjustedConfidence + patternAdjustment.adjustment);
            addDecisionLog({
              status: adjustedConfidence >= bot.minConfidence ? "CHECK" : "BLOCKED",
              message: patternAdjustment.adjustment
                ? `Pattern score adjusted ${patternAdjustment.adjustment > 0 ? "+" : ""}${patternAdjustment.adjustment}: ${patternAdjustment.reason}`
                : `Pattern score unchanged. ${patternAdjustment.reason}`,
              symbol,
              side,
              confidence: adjustedConfidence,
              strategy: bot.strategy,
              source: "scanner",
              details: {
                candle: candle.signal.name,
                patternAdjustment: patternAdjustment.adjustment,
                patternSample: patternAdjustment.sample,
                marketRegime: candle.regime.regime,
                confidenceBefore: Number(candidate.confidence || 0),
                confidenceAfter: adjustedConfidence,
              },
            });

            if (adjustedConfidence < bot.minConfidence) {
              setLastAction?.(`Scanner signal blocked. Pattern-adjusted score ${Math.round(adjustedConfidence)}/100 is below ${bot.minConfidence}/100.`);
              return;
            }
          }
        }
      } catch (err: any) {
        addDecisionLog({
          status: "CHECK",
          message: `Candle confirmation unavailable: ${err?.message || "history fetch failed"}.`,
          symbol,
          side,
          confidence: Number(candidate.confidence || 0),
          strategy: bot.strategy,
          source: "scanner",
        });
      }
    }

    const stability = confirmSignalStability({
      key: `scanner_${bot.strategy}_${symbol}_${side}`,
      label: `${symbol} ${side} ${bot.strategy}`,
    });
    if (!stability.stable) {
      setLastAction?.(`Auto-Bot waiting. ${stability.message}`);
      addDecisionLog({
        status: "CHECK",
        message: stability.message,
        symbol,
        side,
        confidence: adjustedConfidence,
        strategy: bot.strategy,
        source: "scanner",
      });
      return;
    }

    const accepted = await bot.triggerBotTrade(
      symbol,
      side,
      qty,
      `${candidate.signal || bot.strategy} scanner signal`,
      {
        price: numberValue(candidate.entry || candidate.ltp),
        confidence: adjustedConfidence,
        strategy: bot.strategy,
        sl: numberValue(candidate.sl),
        t1: numberValue(candidate.t1),
        t2: numberValue(candidate.t2),
        source: "scanner",
        ...candlePatternContext,
      }
    );

    if (accepted) sessionStorage.setItem(firedKey, "true");
  } catch (err: any) {
    setLastAction?.(`Scanner error: ${err?.message || "unable to evaluate signals"}`);
    addDecisionLog({
      status: "ERROR",
      message: `Scanner error: ${err?.message || "unable to evaluate signals"}`,
      strategy: bot.strategy,
      source: "scanner",
    });
  } finally {
    scanInFlightRef.current = false;
  }
}
