import { api } from "../../lib/api";
import { getLotSizeFromSymbol } from "../../lib/utils";
import { useMarket } from "../marketStore";
import { useSettings } from "../settingsStore";
import { registerSlCooldown } from "./cooldown";
import type { AutoBotState, BotDecisionLog, ManagedExitState } from "./types";
import { readManagedExits, writeManagedExits } from "./storage";

type AddDecisionLog = (entry: Omit<BotDecisionLog, "id" | "time">) => void;
type SetLastAction = (message: string) => void;

function latestOpenOutcomeForSymbol(outcomes: any[], symbol: string) {
  return outcomes
    .filter((outcome) => String(outcome?.symbol || "") === symbol && !outcome?.closed)
    .sort((a, b) => new Date(b?.createdAt || b?.signalTime || 0).getTime() - new Date(a?.createdAt || a?.signalTime || 0).getTime())[0];
}

function directionHitTarget(qty: number, ltp: number, target: number) {
  if (!target) return false;
  return qty > 0 ? ltp >= target : ltp <= target;
}

function directionHitStop(qty: number, ltp: number, stop: number) {
  if (!stop) return false;
  return qty > 0 ? ltp <= stop : ltp >= stop;
}

function entrySideForCooldown(outcome: any, positionQty: number): "BUY" | "SELL" {
  if (outcome?.side === "SELL") return "SELL";
  if (outcome?.side === "BUY") return "BUY";
  return positionQty < 0 ? "SELL" : "BUY";
}

function sourceForCooldown(symbol: string, strategy?: string): "scanner" | "option_chain" {
  const upperStrategy = String(strategy || "").toUpperCase();
  const upperSymbol = symbol.toUpperCase();
  return upperStrategy.includes("OPTION_CHAIN") || upperSymbol.endsWith("CE") || upperSymbol.endsWith("PE")
    ? "option_chain"
    : "scanner";
}

function nextTrailStop(qty: number, ltp: number, entry: number, originalSl: number, state: ManagedExitState) {
  const riskDistance = Math.abs(entry - originalSl);
  if (!riskDistance) return state.trailStop ?? entry;

  if (qty > 0) {
    const highWater = Math.max(state.highWater ?? ltp, ltp);
    const candidate = Math.max(entry, highWater - riskDistance);
    return Math.max(state.trailStop ?? entry, candidate);
  }

  const lowWater = Math.min(state.lowWater ?? ltp, ltp);
  const candidate = Math.min(entry, lowWater + riskDistance);
  return Math.min(state.trailStop ?? entry, candidate);
}

function partialExitQty(symbol: string, totalQty: number, percent: number) {
  const lotSize = getLotSizeFromSymbol(symbol);
  const desiredQty = Math.floor(totalQty * (percent / 100));

  if (lotSize <= 1) {
    return totalQty > 1 ? Math.max(1, Math.min(totalQty - 1, desiredQty)) : totalQty;
  }

  const totalLots = Math.floor(totalQty / lotSize);
  if (totalLots <= 1) return totalQty;

  const desiredLots = Math.floor(desiredQty / lotSize);
  const exitLots = Math.max(1, Math.min(totalLots - 1, desiredLots));
  return exitLots * lotSize;
}

async function exitPaperPosition(
  symbol: string,
  qty: number,
  reason: string,
  outcome: any,
  addDecisionLog: AddDecisionLog,
  setLastAction?: SetLastAction
) {
  const result = await api.paperExit(symbol, qty);
  const message = result?.error
    ? `Auto exit failed: ${result.error}`
    : `${reason}. Exited ${result.exitedQty ?? qty} qty at INR ${Number(result.fill || 0).toFixed(2)}.`;
  setLastAction?.(message);
  addDecisionLog({
    status: result?.error ? "ERROR" : "TRADE",
    message,
    symbol,
    side: outcome?.side === "SELL" ? "BUY" : "SELL",
    confidence: Number(outcome?.confidence || 0),
    strategy: outcome?.strategy,
    source: "scanner",
  });
  return result;
}

export async function manageOpenPaperPositions(
  getBot: () => AutoBotState,
  addDecisionLog: AddDecisionLog,
  exitInFlightRef: { current: boolean },
  setLastAction?: SetLastAction
) {
  const bot = getBot();
  const settings = useSettings.getState();
  if (!bot.enabled || bot.paused || settings.killSwitch || !bot.autoExitEnabled || exitInFlightRef.current) return;
  if (bot.executionMode === "dry_run") return;

  exitInFlightRef.current = true;
  try {
    const [positionsRaw, outcomesRaw] = await Promise.all([
      api.getPaperPositions().catch(() => []),
      api.getPaperOutcomes().catch(() => []),
    ]);

    const positions = Array.isArray(positionsRaw) ? positionsRaw : [];
    const outcomes = Array.isArray(outcomesRaw) ? outcomesRaw : [];
    const managed = readManagedExits();

    for (const position of positions) {
      const symbol = String(position?.symbol || "");
      const qty = Number(position?.qty ?? position?.openQty ?? 0);
      const totalQty = Math.abs(qty);
      const ltp = Number(position?.ltp ?? useMarket.getState().ticks[symbol]?.ltp ?? 0);
      if (!symbol || !totalQty || !ltp) continue;

      const outcome = latestOpenOutcomeForSymbol(outcomes, symbol);
      if (!outcome) continue;

      const key = String(outcome.id || symbol);
      const state = managed[key] || {};
      const entry = Number(outcome.entry || position.avgPrice || 0);
      const originalSl = Number(outcome.sl || 0);
      const t1 = Number(outcome.t1 || 0);
      const t2 = Number(outcome.t2 || 0);

      if (bot.trailingSlEnabled && state.t1Done && originalSl && entry) {
        const trailStop = nextTrailStop(qty, ltp, entry, originalSl, state);
        if (qty > 0) state.highWater = Math.max(state.highWater ?? ltp, ltp);
        else state.lowWater = Math.min(state.lowWater ?? ltp, ltp);

        if (trailStop !== state.trailStop) {
          state.trailStop = trailStop;
          addDecisionLog({
            status: "CHECK",
            message: `Trailing SL updated to INR ${trailStop.toFixed(2)}.`,
            symbol,
            confidence: Number(outcome.confidence || 0),
            strategy: outcome.strategy,
            source: "scanner",
          });
        }
      }

      const effectiveStop = bot.trailingSlEnabled && state.trailStop
        ? qty > 0 ? Math.max(originalSl || 0, state.trailStop) : Math.min(originalSl || Number.MAX_SAFE_INTEGER, state.trailStop)
        : originalSl;

      if (effectiveStop && directionHitStop(qty, ltp, effectiveStop)) {
        const result = await exitPaperPosition(
          symbol,
          totalQty,
          `Auto SL hit at INR ${effectiveStop.toFixed(2)}`,
          outcome,
          addDecisionLog,
          setLastAction
        );
        if (!result?.error) {
          const strategy = String(outcome?.strategy || bot.strategy || "AUTO_BOT");
          const side = entrySideForCooldown(outcome, qty);
          const cooldown = registerSlCooldown({
            symbol,
            side,
            strategy,
            source: sourceForCooldown(symbol, strategy),
          });
          addDecisionLog({
            status: "CHECK",
            message: cooldown.slCount >= 2
              ? `Cooldown set: ${symbol} ${side} locked for today after ${cooldown.slCount} SL exits.`
              : `Cooldown set: ${symbol} ${side} blocked for 30 min after SL.`,
            symbol,
            side,
            confidence: Number(outcome?.confidence || 0),
            strategy,
            source: sourceForCooldown(symbol, strategy),
          });
          delete managed[key];
          writeManagedExits(managed);
        }
        continue;
      }

      if (!state.t2Done && t2 && directionHitTarget(qty, ltp, t2)) {
        state.t2Done = true;
        const result = await exitPaperPosition(
          symbol,
          totalQty,
          `Auto T2 hit at INR ${t2.toFixed(2)}`,
          outcome,
          addDecisionLog,
          setLastAction
        );
        if (!result?.error) {
          delete managed[key];
          writeManagedExits(managed);
        }
        continue;
      }

      if (!state.t1Done && t1 && directionHitTarget(qty, ltp, t1)) {
        const partialQty = partialExitQty(symbol, totalQty, bot.t1ExitPercent);
        state.t1Done = true;
        if (bot.trailingSlEnabled && entry) state.trailStop = entry;
        if (qty > 0) state.highWater = Math.max(state.highWater ?? ltp, ltp);
        else state.lowWater = Math.min(state.lowWater ?? ltp, ltp);

        const result = await exitPaperPosition(
          symbol,
          partialQty,
          `Auto T1 hit at INR ${t1.toFixed(2)}`,
          outcome,
          addDecisionLog,
          setLastAction
        );
        if (!result?.error) {
          if (Number(result.remainingQty || 0) <= 0) delete managed[key];
          else managed[key] = state;
          writeManagedExits(managed);
        }
      }
    }
  } catch (err: any) {
    setLastAction?.(`Auto exit monitor error: ${err?.message || "unable to manage positions"}.`);
    addDecisionLog({
      status: "ERROR",
      message: `Auto exit monitor error: ${err?.message || "unable to manage positions"}.`,
      source: "scanner",
    });
  } finally {
    exitInFlightRef.current = false;
  }
}
