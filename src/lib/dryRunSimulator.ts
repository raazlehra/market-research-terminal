import type { BotDecisionLog } from "../stores/autoBot/types";
import type { CandleInput } from "./candlestickPatterns";
import type { MarketRegime } from "./marketRegime";

export type DryRunSetup = {
  id: string;
  time: string;
  symbol: string;
  side: "BUY" | "SELL";
  strategy: string;
  source: string;
  confidence: number | null;
  entry: number;
  sl: number;
  t1: number;
  t2: number;
  qty: number;
  timeframe: string;
  pattern: string;
  marketRegime?: MarketRegime;
};

export type DryRunSimulation = DryRunSetup & {
  status: "T2" | "T1" | "SL" | "OPEN" | "AMBIGUOUS" | "INCOMPLETE";
  pnl: number;
  rMultiple: number | null;
  exitPrice: number | null;
  checkedCandles: number;
  hitTime?: string;
};

export type DryRunSimulationSummary = {
  rows: DryRunSimulation[];
  complete: DryRunSimulation[];
  open: DryRunSimulation[];
  incomplete: DryRunSimulation[];
  wins: number;
  losses: number;
  ambiguous: number;
  t1Hits: number;
  t2Hits: number;
  slHits: number;
  netPnl: number;
  avgR: number | null;
  winRate: number;
};

export type GuardEffectivenessSummary = {
  rows: DryRunSimulation[];
  complete: DryRunSimulation[];
  savedLosses: number;
  missedWins: number;
  open: number;
  incomplete: number;
  ambiguous: number;
  netAvoidedPnl: number;
};

export const DRY_RUN_SIM_OUTCOMES_KEY = "fyers_auto_bot_dry_run_simulated_outcomes";

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function detailNumber(entry: BotDecisionLog, key: string): number {
  return finiteNumber(entry.details?.[key]) ?? 0;
}

function detailText(entry: BotDecisionLog, key: string): string {
  const value = entry.details?.[key];
  return typeof value === "string" ? value : "";
}

function parseEntryFromMessage(message: string): number {
  const match = message.match(/\bat\s+INR\s+([0-9,.]+)/i);
  return finiteNumber(match?.[1]?.replace(/,/g, "")) ?? 0;
}

function isDryRun(entry: BotDecisionLog): boolean {
  return entry.details?.executionMode === "dry_run" || entry.message.startsWith("DRY RUN:");
}

function isRegimeGuardBlock(entry: BotDecisionLog): boolean {
  return entry.status === "BLOCKED" && (
    entry.details?.regimeGuardMinScore !== undefined ||
    /regime\s+[A-Z_]+\s+needs candle/i.test(entry.message)
  );
}

export function extractDryRunSetups(decisions: BotDecisionLog[], fallbackTimeframe = "5"): DryRunSetup[] {
  return decisions
    .filter(isDryRun)
    .map((entry) => {
      const marketRegime = detailText(entry, "marketRegime");
      const setup: DryRunSetup = {
        id: entry.id,
        time: entry.time,
        symbol: entry.symbol || "",
        side: entry.side === "SELL" ? "SELL" : "BUY",
        strategy: entry.strategy || "Auto-Bot",
        source: entry.source || "scanner",
        confidence: entry.confidence === undefined ? null : Number(entry.confidence),
        entry: detailNumber(entry, "entry") || parseEntryFromMessage(entry.message),
        sl: detailNumber(entry, "sl"),
        t1: detailNumber(entry, "t1"),
        t2: detailNumber(entry, "t2"),
        qty: detailNumber(entry, "qty") || detailNumber(entry, "finalQty") || 1,
        timeframe: detailText(entry, "candleTimeframe") || fallbackTimeframe,
        pattern: detailText(entry, "candle") || "No pattern",
        marketRegime: marketRegime ? marketRegime as MarketRegime : undefined,
      };
      return setup;
    })
    .filter((setup) => setup.symbol)
    .slice(0, 12);
}

export function extractRegimeGuardSetups(decisions: BotDecisionLog[], fallbackTimeframe = "5"): DryRunSetup[] {
  return decisions
    .filter(isRegimeGuardBlock)
    .map((entry) => {
      const marketRegime = detailText(entry, "marketRegime");
      const setup: DryRunSetup = {
        id: `guard:${entry.id}`,
        time: entry.time,
        symbol: entry.symbol || "",
        side: entry.side === "SELL" ? "SELL" : "BUY",
        strategy: entry.strategy || "Regime Guard",
        source: entry.source || "option_chain",
        confidence: entry.confidence === undefined ? null : Number(entry.confidence),
        entry: detailNumber(entry, "entry") || parseEntryFromMessage(entry.message),
        sl: detailNumber(entry, "sl"),
        t1: detailNumber(entry, "t1"),
        t2: detailNumber(entry, "t2"),
        qty: detailNumber(entry, "qty") || detailNumber(entry, "finalQty") || 1,
        timeframe: detailText(entry, "candleTimeframe") || fallbackTimeframe,
        pattern: detailText(entry, "candle") || "Regime Guard",
        marketRegime: marketRegime ? marketRegime as MarketRegime : undefined,
      };
      return setup;
    })
    .filter((setup) => setup.symbol)
    .slice(0, 12);
}

function candleMillis(candle: CandleInput): number {
  const ts = finiteNumber(candle.ts);
  if (!ts) return 0;
  return ts > 10_000_000_000 ? ts : ts * 1000;
}

function candleHitTime(candle: CandleInput): string {
  const millis = candleMillis(candle);
  return millis ? new Date(millis).toISOString() : "";
}

function direction(setup: DryRunSetup): 1 | -1 {
  return setup.side === "SELL" ? -1 : 1;
}

function pnlFor(setup: DryRunSetup, price: number): number {
  return (price - setup.entry) * setup.qty * direction(setup);
}

function rMultiple(setup: DryRunSetup, pnl: number): number | null {
  const risk = Math.abs(setup.entry - setup.sl) * setup.qty;
  return risk > 0 ? pnl / risk : null;
}

function exitPriceFor(status: DryRunSimulation["status"], setup: DryRunSetup, lastClose: number): number | null {
  if (status === "T2") return setup.t2;
  if (status === "T1") return setup.t1;
  if (status === "SL") return setup.sl;
  if (status === "OPEN") return lastClose;
  return null;
}

export function simulateDryRun(setup: DryRunSetup, candles: CandleInput[]): DryRunSimulation {
  const valid = setup.entry > 0 && setup.sl > 0 && setup.t1 > 0 && setup.t2 > 0 && setup.qty > 0;
  if (!valid) {
    return { ...setup, status: "INCOMPLETE", pnl: 0, rMultiple: null, exitPrice: null, checkedCandles: 0 };
  }

  const start = new Date(setup.time).getTime();
  const afterEntry = candles
    .filter((candle) => candleMillis(candle) >= start)
    .sort((a, b) => candleMillis(a) - candleMillis(b));
  if (!afterEntry.length) {
    return { ...setup, status: "OPEN", pnl: 0, rMultiple: null, exitPrice: null, checkedCandles: 0 };
  }

  for (const candle of afterEntry) {
    const hitSl = setup.side === "SELL" ? candle.high >= setup.sl : candle.low <= setup.sl;
    const hitT2 = setup.side === "SELL" ? candle.low <= setup.t2 : candle.high >= setup.t2;
    const hitT1 = setup.side === "SELL" ? candle.low <= setup.t1 : candle.high >= setup.t1;
    const targetHit = hitT2 || hitT1;
    const status: DryRunSimulation["status"] =
      hitSl && targetHit ? "AMBIGUOUS" :
      hitT2 ? "T2" :
      hitT1 ? "T1" :
      hitSl ? "SL" :
      "OPEN";

    if (status !== "OPEN") {
      const exitPrice = exitPriceFor(status, setup, candle.close);
      const pnl = exitPrice === null ? 0 : pnlFor(setup, exitPrice);
      return {
        ...setup,
        status,
        pnl: Number(pnl.toFixed(2)),
        rMultiple: rMultiple(setup, pnl),
        exitPrice,
        checkedCandles: afterEntry.length,
        hitTime: candleHitTime(candle),
      };
    }
  }

  const last = afterEntry[afterEntry.length - 1];
  const pnl = pnlFor(setup, last.close);
  return {
    ...setup,
    status: "OPEN",
    pnl: Number(pnl.toFixed(2)),
    rMultiple: rMultiple(setup, pnl),
    exitPrice: last.close,
    checkedCandles: afterEntry.length,
  };
}

function isCompletedSimulation(row: DryRunSimulation): boolean {
  return row.status === "T1" || row.status === "T2" || row.status === "SL";
}

export function dryRunSimulationToOutcome(row: DryRunSimulation): Record<string, unknown> | null {
  if (!isCompletedSimulation(row) || !row.pattern || row.pattern === "No pattern") return null;
  const orderId = `dry-run:${row.id}`;
  const confidence = row.confidence ?? 0;
  return {
    id: orderId,
    orderId,
    signalTime: row.time,
    symbol: row.symbol,
    side: row.side,
    qty: row.qty,
    strategy: row.strategy,
    confidence,
    entry: row.entry,
    sl: row.sl,
    t1: row.t1,
    t2: row.t2,
    slHit: row.status === "SL",
    t1Hit: row.status === "T1" || row.status === "T2",
    t2Hit: row.status === "T2",
    closed: true,
    pnl: row.pnl,
    notes: `Dry Run Simulation. Pattern: ${row.pattern} (${Math.round(confidence)}/100, simulated, ${row.timeframe}m).${row.marketRegime ? ` Regime: ${row.marketRegime}.` : ""}`,
    marketRegime: row.marketRegime,
    createdAt: row.hitTime || row.time,
    updatedAt: new Date().toISOString(),
    simulated: true,
  };
}

export function readDryRunSimulatedOutcomes(): Record<string, unknown>[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(DRY_RUN_SIM_OUTCOMES_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((row) => row && typeof row === "object") : [];
  } catch {
    return [];
  }
}

export function writeDryRunSimulatedOutcomes(rows: Record<string, unknown>[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(DRY_RUN_SIM_OUTCOMES_KEY, JSON.stringify(rows.slice(0, 200)));
}

export function persistDryRunSimulatedOutcomes(rows: DryRunSimulation[]): number {
  const outcomes = rows
    .map(dryRunSimulationToOutcome)
    .filter((row): row is Record<string, unknown> => Boolean(row));
  if (!outcomes.length) return 0;

  const merged = new Map<string, Record<string, unknown>>();
  for (const row of readDryRunSimulatedOutcomes()) {
    const key = String(row.orderId || row.id || "");
    if (key) merged.set(key, row);
  }
  for (const row of outcomes) {
    const key = String(row.orderId || row.id || "");
    if (key) merged.set(key, row);
  }

  const next = [...merged.values()].sort((a, b) =>
    new Date(String(b.createdAt || b.signalTime || 0)).getTime() - new Date(String(a.createdAt || a.signalTime || 0)).getTime()
  );
  writeDryRunSimulatedOutcomes(next);
  return outcomes.length;
}

export function summarizeDryRunSimulations(rows: DryRunSimulation[]): DryRunSimulationSummary {
  const complete = rows.filter((row) => row.status === "T1" || row.status === "T2" || row.status === "SL");
  const open = rows.filter((row) => row.status === "OPEN");
  const incomplete = rows.filter((row) => row.status === "INCOMPLETE");
  const rValues = rows.map((row) => row.rMultiple).filter((value): value is number => value !== null && Number.isFinite(value));
  const wins = complete.filter((row) => row.status === "T1" || row.status === "T2").length;

  return {
    rows,
    complete,
    open,
    incomplete,
    wins,
    losses: complete.filter((row) => row.status === "SL").length,
    ambiguous: rows.filter((row) => row.status === "AMBIGUOUS").length,
    t1Hits: rows.filter((row) => row.status === "T1" || row.status === "T2").length,
    t2Hits: rows.filter((row) => row.status === "T2").length,
    slHits: rows.filter((row) => row.status === "SL").length,
    netPnl: Number(rows.reduce((sum, row) => sum + row.pnl, 0).toFixed(2)),
    avgR: rValues.length ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length : null,
    winRate: complete.length ? wins / complete.length : 0,
  };
}

export function summarizeGuardEffectiveness(rows: DryRunSimulation[]): GuardEffectivenessSummary {
  const complete = rows.filter((row) => row.status === "T1" || row.status === "T2" || row.status === "SL");
  return {
    rows,
    complete,
    savedLosses: complete.filter((row) => row.status === "SL").length,
    missedWins: complete.filter((row) => row.status === "T1" || row.status === "T2").length,
    open: rows.filter((row) => row.status === "OPEN").length,
    incomplete: rows.filter((row) => row.status === "INCOMPLETE").length,
    ambiguous: rows.filter((row) => row.status === "AMBIGUOUS").length,
    netAvoidedPnl: Number((-complete.reduce((sum, row) => sum + row.pnl, 0)).toFixed(2)),
  };
}
