import { patternAdjustmentFromRow, patternGuardrailFromOutcomes, type PatternConfidenceAdjustment } from "./patternConfidence";
import type { PatternOutcomeRow, PatternOutcomeSummary } from "./patternOutcomeTracker";

export type PatternLearningAuditRow = {
  pattern: string;
  regime?: string;
  adjustment: PatternConfidenceAdjustment;
  closed: number;
  paperClosed: number;
  dryRunClosed: number;
  winRate: number | null;
  avgR: number | null;
  netPnl: number;
  lastOutcome: string;
  lastOutcomeAt: string;
  evidence: "READY" | "GUARDED" | "BUILDING" | "NO DATA";
};

export type PatternLearningAuditSummary = {
  rows: PatternLearningAuditRow[];
  ready: number;
  guarded: number;
  building: number;
  paperClosed: number;
  dryRunClosed: number;
};

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function outcomeTime(outcome: Record<string, unknown>): string {
  return String(outcome.createdAt || outcome.signalTime || outcome.time || "");
}

function isClosed(outcome: Record<string, unknown>): boolean {
  return Boolean(outcome.closed) || outcome.pnl !== null && outcome.pnl !== undefined;
}

function isDryRunOutcome(outcome: Record<string, unknown>): boolean {
  return Boolean(outcome.simulated) || String(outcome.orderId || outcome.id || "").startsWith("dry-run:");
}

function parsePatternNote(notes: unknown): string {
  const text = String(notes || "");
  const match = text.match(/Pattern:\s*([^(.]+)\s*\(/i);
  return match?.[1]?.trim() || "";
}

function parseRegimeNote(notes: unknown): string {
  const text = String(notes || "");
  const match = text.match(/Regime:\s*([A-Z_]+)/i);
  return match?.[1]?.trim().toUpperCase() || "";
}

function outcomeLabel(outcome: Record<string, unknown>): string {
  if (Boolean(outcome.t2Hit)) return "T2";
  if (Boolean(outcome.t1Hit)) return "T1";
  if (Boolean(outcome.slHit)) return "SL";
  const pnl = finiteNumber(outcome.pnl);
  if (pnl === null) return "OPEN";
  return pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "FLAT";
}

function rowEvidence(row: PatternOutcomeRow, adjustment: PatternConfidenceAdjustment): PatternLearningAuditRow["evidence"] {
  if (adjustment.guardrailActive) return "GUARDED";
  if (row.closed >= 3) return "READY";
  if (row.closed > 0 || adjustment.sample > 0) return "BUILDING";
  return "NO DATA";
}

export function summarizePatternLearningAudit(
  patternSummary: PatternOutcomeSummary,
  outcomes: unknown[],
  maxAdjustment: number
): PatternLearningAuditSummary {
  const sourceCounts = new Map<string, { paperClosed: number; dryRunClosed: number; lastOutcome: string; lastOutcomeAt: string }>();

  outcomes.forEach((raw) => {
    if (!raw || typeof raw !== "object") return;
    const outcome = raw as Record<string, unknown>;
    if (!isClosed(outcome)) return;
    const pattern = parsePatternNote(outcome.notes);
    if (!pattern) return;
    const regime = parseRegimeNote(outcome.notes);
    const key = regime ? `${pattern}::${regime}` : pattern;

    const current = sourceCounts.get(key) || { paperClosed: 0, dryRunClosed: 0, lastOutcome: "", lastOutcomeAt: "" };
    if (isDryRunOutcome(outcome)) current.dryRunClosed += 1;
    else current.paperClosed += 1;

    const at = outcomeTime(outcome);
    if (!current.lastOutcomeAt || new Date(at).getTime() > new Date(current.lastOutcomeAt).getTime()) {
      current.lastOutcomeAt = at;
      current.lastOutcome = `${outcomeLabel(outcome)} ${finiteNumber(outcome.pnl) === null ? "" : `(${finiteNumber(outcome.pnl)?.toFixed(2)})`}`.trim();
    }
    sourceCounts.set(key, current);
  });

  const rows = patternSummary.rows.map((row) => {
    const guardrail = patternGuardrailFromOutcomes(row.pattern, outcomes, row.regime);
    const adjustment = patternAdjustmentFromRow(row, maxAdjustment, guardrail, row.regime ? "regime" : "pattern");
    const key = row.regime ? `${row.pattern}::${row.regime}` : row.pattern;
    const sources = sourceCounts.get(key) || { paperClosed: 0, dryRunClosed: 0, lastOutcome: "", lastOutcomeAt: "" };
    return {
      pattern: row.pattern,
      regime: row.regime,
      adjustment,
      closed: row.closed,
      paperClosed: sources.paperClosed,
      dryRunClosed: sources.dryRunClosed,
      winRate: row.closed ? row.wins / row.closed : null,
      avgR: row.avgR,
      netPnl: row.netPnl,
      lastOutcome: sources.lastOutcome || "--",
      lastOutcomeAt: sources.lastOutcomeAt,
      evidence: rowEvidence(row, adjustment),
    };
  }).sort((a, b) => {
    if (a.evidence !== b.evidence) {
      if (a.evidence === "GUARDED") return -1;
      if (b.evidence === "GUARDED") return 1;
      return a.evidence === "READY" ? -1 : b.evidence === "READY" ? 1 : 0;
    }
    if (Math.abs(b.adjustment.adjustment) !== Math.abs(a.adjustment.adjustment)) {
      return Math.abs(b.adjustment.adjustment) - Math.abs(a.adjustment.adjustment);
    }
    return b.closed - a.closed;
  });

  return {
    rows,
    ready: rows.filter((row) => row.evidence === "READY").length,
    guarded: rows.filter((row) => row.evidence === "GUARDED").length,
    building: rows.filter((row) => row.evidence === "BUILDING").length,
    paperClosed: rows.reduce((sum, row) => sum + row.paperClosed, 0),
    dryRunClosed: rows.reduce((sum, row) => sum + row.dryRunClosed, 0),
  };
}
