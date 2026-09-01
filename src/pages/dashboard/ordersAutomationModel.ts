import { MARKET_REGIME_DISPLAY, type MarketRegime } from "../../lib/marketRegime";
import { inr } from "../../lib/utils";
import type { BotDecisionLog } from "../../stores/autoBot/types";

export type SessionSummary = {
  rows: BotDecisionLog[];
  loggedScans: number;
  candidatesChecked: number;
  dryRuns: number;
  paperTrades: number;
  blocked: number;
  regimeGuardBlocks: number;
  regimeGuardBreakdown: { regime: MarketRegime; count: number }[];
  skipped: number;
  errors: number;
  topReason: string;
  bestSetup: string;
  bestConfidence: number | null;
  bestIndex: string;
};

export type BotPerformanceSummary = {
  outcomes: any[];
  closed: any[];
  open: any[];
  netPnl: number;
  wins: number;
  losses: number;
  winRate: number;
  t1Hits: number;
  t2Hits: number;
  slHits: number;
  avgR: number | null;
  bestStrategy: string;
  dryRunSignals: number;
  dryRunReady: number;
};

export type LatestRegimeSummary = {
  regime: MarketRegime;
  trendPct: number | null;
  rangePct: number | null;
  symbol: string;
  time: string;
} | null;

export function isToday(value: string) {
  const dt = new Date(value);
  return !Number.isNaN(dt.getTime()) && dt.toDateString() === new Date().toDateString();
}

export function numberDetail(entry: BotDecisionLog, key: string) {
  const value = entry.details?.[key];
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function textDetail(entry: BotDecisionLog, key: string) {
  const value = entry.details?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function nullableNumberDetail(entry: BotDecisionLog, key: string): number | null {
  const value = entry.details?.[key];
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isMarketRegime(value: string): value is MarketRegime {
  return value in MARKET_REGIME_DISPLAY;
}

function regimeFromGuard(entry: BotDecisionLog): MarketRegime | null {
  const detailRegime = textDetail(entry, "marketRegime");
  if (isMarketRegime(detailRegime)) return detailRegime;
  const match = entry.message.match(/regime\s+([A-Z_]+)\s+needs candle/i);
  const messageRegime = match?.[1]?.toUpperCase() || "";
  return isMarketRegime(messageRegime) ? messageRegime : null;
}

export function latestMarketRegime(rows: BotDecisionLog[]): LatestRegimeSummary {
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const entry = rows[i];
    const regime = textDetail(entry, "marketRegime");
    if (!isMarketRegime(regime)) continue;
    return {
      regime,
      trendPct: nullableNumberDetail(entry, "regimeTrend"),
      rangePct: nullableNumberDetail(entry, "regimeRange"),
      symbol: entry.symbol || textDetail(entry, "winner") || "Auto-Bot",
      time: entry.time,
    };
  }
  return null;
}

function rejectReason(message: string) {
  return message
    .replace(/^DRY RUN:\s*/i, "")
    .replace(/^Option Auto-Bot blocked\.\s*/i, "")
    .replace(/^Trade blocked\.\s*/i, "")
    .replace(/^Scanner signal skipped\.\s*/i, "")
    .split(".")[0]
    .trim()
    .slice(0, 80) || "No reason captured";
}

export function summarizeBotSession(rows: BotDecisionLog[]): SessionSummary {
  const todayRows = rows.filter((entry) => isToday(entry.time));
  const reasonCounts = new Map<string, number>();
  const regimeGuardRows = todayRows.filter((entry) =>
    entry.details?.regimeGuardMinScore !== undefined || /regime\s+[A-Z_]+\s+needs candle/i.test(entry.message)
  );
  const regimeGuardCounts = new Map<MarketRegime, number>();
  regimeGuardRows.forEach((entry) => {
    const regime = regimeFromGuard(entry);
    if (regime) regimeGuardCounts.set(regime, (regimeGuardCounts.get(regime) || 0) + 1);
  });
  let candidatesChecked = 0;
  let bestSetup = "No setup yet";
  let bestConfidence: number | null = null;
  let bestIndex = "";

  todayRows.forEach((entry) => {
    candidatesChecked += numberDetail(entry, "candidates") || numberDetail(entry, "results");
    const winner = textDetail(entry, "winner");
    if (winner) bestIndex = winner;

    if ((entry.status === "SKIP" || entry.status === "BLOCKED" || entry.status === "ERROR") && entry.message) {
      const reason = rejectReason(entry.message);
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }

    if (entry.confidence !== undefined && (bestConfidence === null || Number(entry.confidence) > bestConfidence)) {
      bestConfidence = Number(entry.confidence);
      bestSetup = entry.symbol || winner || "Unnamed setup";
    }
  });

  const topReason = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "No rejects today";

  return {
    rows: todayRows,
    loggedScans: todayRows.filter((entry) => entry.source === "scanner" && entry.status === "CHECK").length,
    candidatesChecked,
    dryRuns: todayRows.filter((entry) => entry.message.startsWith("DRY RUN:")).length,
    paperTrades: todayRows.filter((entry) => entry.status === "TRADE").length,
    blocked: todayRows.filter((entry) => entry.status === "BLOCKED").length,
    regimeGuardBlocks: regimeGuardRows.length,
    regimeGuardBreakdown: [...regimeGuardCounts.entries()]
      .map(([regime, count]) => ({ regime, count }))
      .sort((a, b) => b.count - a.count),
    skipped: todayRows.filter((entry) => entry.status === "SKIP").length,
    errors: todayRows.filter((entry) => entry.status === "ERROR").length,
    topReason,
    bestSetup,
    bestConfidence,
    bestIndex: bestIndex || "No index winner yet",
  };
}

function outcomeTime(outcome: any) {
  return String(outcome?.signalTime || outcome?.createdAt || outcome?.time || "");
}

function isBotPaperOutcome(outcome: any) {
  const notes = String(outcome?.notes || "").toLowerCase();
  const strategy = String(outcome?.strategy || "").toUpperCase();
  return notes.includes("auto-bot") || strategy === "OPTION_CHAIN_CONFLUENCE";
}

function outcomePnl(outcome: any) {
  const value = Number(outcome?.pnl);
  return Number.isFinite(value) ? value : 0;
}

function outcomeR(outcome: any) {
  const pnl = outcomePnl(outcome);
  const entry = Number(outcome?.entry || 0);
  const sl = Number(outcome?.sl || 0);
  const qty = Math.abs(Number(outcome?.qty || 0));
  const risk = Math.abs(entry - sl) * qty;
  return risk > 0 ? pnl / risk : null;
}

export function summarizeBotPerformance(outcomes: any[], decisions: BotDecisionLog[]): BotPerformanceSummary {
  const todayOutcomes = outcomes.filter((outcome) => isToday(outcomeTime(outcome)) && isBotPaperOutcome(outcome));
  const closed = todayOutcomes.filter((outcome) => Boolean(outcome?.closed) || outcome?.pnl !== null && outcome?.pnl !== undefined);
  const open = todayOutcomes.filter((outcome) => !closed.includes(outcome));
  const strategyPnl = new Map<string, number>();
  const rValues: number[] = [];

  closed.forEach((outcome) => {
    const strategy = String(outcome?.strategy || "Auto-Bot");
    const pnl = outcomePnl(outcome);
    strategyPnl.set(strategy, (strategyPnl.get(strategy) || 0) + pnl);
    const r = outcomeR(outcome);
    if (r !== null && Number.isFinite(r)) rValues.push(r);
  });

  const bestStrategy = [...strategyPnl.entries()].sort((a, b) => b[1] - a[1])[0];
  const todayDecisions = decisions.filter((entry) => isToday(entry.time));
  const dryRuns = todayDecisions.filter((entry) => entry.message.startsWith("DRY RUN:"));

  return {
    outcomes: todayOutcomes,
    closed,
    open,
    netPnl: closed.reduce((sum, outcome) => sum + outcomePnl(outcome), 0),
    wins: closed.filter((outcome) => outcomePnl(outcome) > 0 || outcome?.t1Hit || outcome?.t2Hit).length,
    losses: closed.filter((outcome) => outcomePnl(outcome) < 0 || outcome?.slHit).length,
    winRate: closed.length ? closed.filter((outcome) => outcomePnl(outcome) > 0 || outcome?.t1Hit || outcome?.t2Hit).length / closed.length : 0,
    t1Hits: closed.filter((outcome) => outcome?.t1Hit).length,
    t2Hits: closed.filter((outcome) => outcome?.t2Hit).length,
    slHits: closed.filter((outcome) => outcome?.slHit).length,
    avgR: rValues.length ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length : null,
    bestStrategy: bestStrategy ? `${bestStrategy[0]} ${inr(bestStrategy[1])}` : "No closed bot trades",
    dryRunSignals: dryRuns.length,
    dryRunReady: dryRuns.filter((entry) => entry.status === "CHECK").length,
  };
}
