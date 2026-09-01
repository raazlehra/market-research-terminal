import type { BotDecisionLog } from "../stores/autoBot/types";

export type PatternOutcomeRow = {
  pattern: string;
  regime?: string;
  observed: number;
  blocked: number;
  trades: number;
  closed: number;
  wins: number;
  losses: number;
  t1Hits: number;
  t2Hits: number;
  slHits: number;
  netPnl: number;
  avgR: number | null;
  avgScore: number | null;
  lastSeen: string;
};

export type PatternOutcomeSummary = {
  rows: PatternOutcomeRow[];
  bestPattern: PatternOutcomeRow | null;
  trackedTrades: number;
  blockedByPattern: number;
};

type PatternTag = {
  pattern: string;
  regime?: string;
  score?: number;
  time?: string;
};

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function outcomeTime(outcome: Record<string, unknown>): string {
  return String(outcome.signalTime || outcome.createdAt || outcome.time || "");
}

function isClosed(outcome: Record<string, unknown>): boolean {
  return Boolean(outcome.closed) || outcome.pnl !== null && outcome.pnl !== undefined;
}

function outcomePnl(outcome: Record<string, unknown>): number {
  return finiteNumber(outcome.pnl) ?? 0;
}

function outcomeR(outcome: Record<string, unknown>): number | null {
  const pnl = outcomePnl(outcome);
  const entry = finiteNumber(outcome.entry) ?? 0;
  const sl = finiteNumber(outcome.sl) ?? 0;
  const qty = Math.abs(finiteNumber(outcome.qty) ?? 0);
  const risk = Math.abs(entry - sl) * qty;
  return risk > 0 ? pnl / risk : null;
}

function parsePatternNote(notes: unknown): PatternTag | null {
  const text = String(notes || "");
  const match = text.match(/Pattern:\s*([^(.]+)\s*\(([^,)]+)/i);
  if (!match) return null;
  const pattern = match[1]?.trim();
  if (!pattern) return null;
  const regimeMatch = text.match(/Regime:\s*([A-Z_]+)/i);
  return {
    pattern,
    regime: regimeMatch?.[1]?.trim().toUpperCase(),
    score: finiteNumber(String(match[2] || "").replace("%", "")) ?? undefined,
  };
}

function patternFromDecision(entry: BotDecisionLog): PatternTag | null {
  const candle = entry.details?.candle;
  if (typeof candle !== "string" || !candle.trim() || candle === "No clear candle pattern") return null;
  return {
    pattern: candle.trim(),
    regime: typeof entry.details?.marketRegime === "string" ? entry.details.marketRegime : undefined,
    score: finiteNumber(entry.details?.candleScore) ?? undefined,
    time: entry.time,
  };
}

function nearestDecisionPattern(outcome: Record<string, unknown>, decisions: BotDecisionLog[]): PatternTag | null {
  const symbol = String(outcome.symbol || "");
  const time = new Date(outcomeTime(outcome)).getTime();
  if (!symbol || Number.isNaN(time)) return null;

  let bestDelta = Number.POSITIVE_INFINITY;
  let bestTag: PatternTag | null = null;
  for (const entry of decisions) {
    if (entry.symbol !== symbol) continue;
    const tag = patternFromDecision(entry);
    if (!tag) continue;
    const entryTime = new Date(entry.time).getTime();
    if (Number.isNaN(entryTime)) continue;
    const delta = Math.abs(time - entryTime);
    if (delta > 20 * 60 * 1000) continue;
    if (delta < bestDelta) {
      bestDelta = delta;
      bestTag = tag;
    }
  }
  return bestTag;
}

function blankRow(pattern: string, regime?: string): PatternOutcomeRow {
  return {
    pattern,
    regime,
    observed: 0,
    blocked: 0,
    trades: 0,
    closed: 0,
    wins: 0,
    losses: 0,
    t1Hits: 0,
    t2Hits: 0,
    slHits: 0,
    netPnl: 0,
    avgR: null,
    avgScore: null,
    lastSeen: "",
  };
}

function rowKey(pattern: string, regime?: string): string {
  return regime ? `${pattern}::${regime}` : pattern;
}

function rowFor(rows: Map<string, PatternOutcomeRow>, pattern: string, regime?: string): PatternOutcomeRow {
  const key = rowKey(pattern, regime);
  const current = rows.get(key);
  if (current) return current;
  const next = blankRow(pattern, regime);
  rows.set(key, next);
  return next;
}

function rememberScore(scores: Map<string, number[]>, pattern: string, score?: number): void {
  if (!Number.isFinite(score)) return;
  const list = scores.get(pattern) || [];
  list.push(Number(score));
  scores.set(pattern, list);
}

function rememberR(rValues: Map<string, number[]>, pattern: string, value: number | null): void {
  if (value === null || !Number.isFinite(value)) return;
  const list = rValues.get(pattern) || [];
  list.push(value);
  rValues.set(pattern, list);
}

function setLastSeen(row: PatternOutcomeRow, value: string): void {
  if (!value) return;
  if (!row.lastSeen || new Date(value).getTime() > new Date(row.lastSeen).getTime()) {
    row.lastSeen = value;
  }
}

export function summarizePatternOutcomes(
  outcomesInput: unknown[],
  decisions: BotDecisionLog[],
  options: { regime?: string; keyByRegime?: boolean } = {}
): PatternOutcomeSummary {
  const rows = new Map<string, PatternOutcomeRow>();
  const scores = new Map<string, number[]>();
  const rValues = new Map<string, number[]>();

  decisions.forEach((entry) => {
    const tag = patternFromDecision(entry);
    if (!tag) return;
    if (options.regime && tag.regime !== options.regime) return;
    const row = rowFor(rows, tag.pattern, options.keyByRegime ? tag.regime : undefined);
    row.observed += 1;
    if (entry.status === "BLOCKED") row.blocked += 1;
    rememberScore(scores, tag.pattern, tag.score);
    setLastSeen(row, entry.time);
  });

  outcomesInput.forEach((raw) => {
    if (!raw || typeof raw !== "object") return;
    const outcome = raw as Record<string, unknown>;
    const tag = parsePatternNote(outcome.notes) || nearestDecisionPattern(outcome, decisions);
    if (!tag) return;
    if (options.regime && tag.regime !== options.regime) return;

    const row = rowFor(rows, tag.pattern, options.keyByRegime ? tag.regime : undefined);
    const closed = isClosed(outcome);
    const pnl = outcomePnl(outcome);
    row.trades += 1;
    row.closed += closed ? 1 : 0;
    row.wins += closed && (pnl > 0 || Boolean(outcome.t1Hit) || Boolean(outcome.t2Hit)) ? 1 : 0;
    row.losses += closed && (pnl < 0 || Boolean(outcome.slHit)) ? 1 : 0;
    row.t1Hits += Boolean(outcome.t1Hit) ? 1 : 0;
    row.t2Hits += Boolean(outcome.t2Hit) ? 1 : 0;
    row.slHits += Boolean(outcome.slHit) ? 1 : 0;
    row.netPnl += closed ? pnl : 0;
    rememberScore(scores, tag.pattern, tag.score);
    rememberR(rValues, tag.pattern, closed ? outcomeR(outcome) : null);
    setLastSeen(row, outcomeTime(outcome));
  });

  const summaryRows = [...rows.values()].map((row) => {
    const rowScores = scores.get(row.pattern) || [];
    const rowRValues = rValues.get(row.pattern) || [];
    return {
      ...row,
      netPnl: Number(row.netPnl.toFixed(2)),
      avgScore: rowScores.length ? rowScores.reduce((sum, value) => sum + value, 0) / rowScores.length : null,
      avgR: rowRValues.length ? rowRValues.reduce((sum, value) => sum + value, 0) / rowRValues.length : null,
    };
  }).sort((a, b) => {
    if (b.closed !== a.closed) return b.closed - a.closed;
    if (b.trades !== a.trades) return b.trades - a.trades;
    return b.netPnl - a.netPnl;
  });

  const bestPattern = summaryRows
    .filter((row) => row.closed > 0)
    .sort((a, b) => b.netPnl - a.netPnl || b.wins - a.wins)[0] || null;

  return {
    rows: summaryRows,
    bestPattern,
    trackedTrades: summaryRows.reduce((sum, row) => sum + row.trades, 0),
    blockedByPattern: summaryRows.reduce((sum, row) => sum + row.blocked, 0),
  };
}
