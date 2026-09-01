import { api } from "./api";
import { readDryRunSimulatedOutcomes } from "./dryRunSimulator";
import { summarizePatternOutcomes, type PatternOutcomeRow } from "./patternOutcomeTracker";
import type { BotDecisionLog } from "../stores/autoBot/types";

export type PatternConfidenceAdjustment = {
  adjustment: number;
  sample: number;
  winRate: number | null;
  avgR: number | null;
  reason: string;
  regime?: string;
  scope?: "pattern" | "regime";
  guardrailActive?: boolean;
  recentSlHits?: number;
};

export type PatternLearningGuardrail = {
  active: boolean;
  recentSlHits: number;
  reason: string;
};

const MIN_CLOSED_SAMPLE = 3;
const RECENT_SL_GUARDRAIL_LIMIT = 2;
const CACHE_MS = 120000;

let outcomeCache: { at: number; rows: unknown[] } | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function capValue(value: number): number {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? clamp(parsed, 0, 15) : 0;
}

function isClosed(outcome: Record<string, unknown>): boolean {
  return Boolean(outcome.closed) || outcome.pnl !== null && outcome.pnl !== undefined;
}

function outcomeTime(outcome: Record<string, unknown>): string {
  return String(outcome.createdAt || outcome.signalTime || outcome.time || "");
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

function isSlOutcome(outcome: Record<string, unknown>): boolean {
  if (Boolean(outcome.slHit)) return true;
  const pnl = Number(outcome.pnl);
  return Number.isFinite(pnl) && pnl < 0 && !Boolean(outcome.t1Hit) && !Boolean(outcome.t2Hit);
}

async function loadPaperOutcomes(): Promise<unknown[]> {
  const now = Date.now();
  if (!outcomeCache || now - outcomeCache.at >= CACHE_MS) {
    const rows = await api.getPaperOutcomes();
    outcomeCache = { at: now, rows: Array.isArray(rows) ? rows : [] };
  }
  return [...outcomeCache.rows, ...readDryRunSimulatedOutcomes()];
}

export function patternGuardrailFromOutcomes(pattern: string, outcomes: unknown[], regime?: string): PatternLearningGuardrail {
  const patternOutcomes = outcomes
    .filter((raw): raw is Record<string, unknown> => Boolean(raw) && typeof raw === "object")
    .filter((outcome) => isClosed(outcome) && parsePatternNote(outcome.notes) === pattern)
    .filter((outcome) => !regime || parseRegimeNote(outcome.notes) === regime)
    .sort((a, b) => new Date(outcomeTime(b)).getTime() - new Date(outcomeTime(a)).getTime());

  let recentSlHits = 0;
  for (const outcome of patternOutcomes) {
    if (!isSlOutcome(outcome)) break;
    recentSlHits += 1;
  }

  const active = recentSlHits >= RECENT_SL_GUARDRAIL_LIMIT;
  return {
    active,
    recentSlHits,
    reason: active
      ? `Guardrail active: latest ${recentSlHits} closed outcomes hit SL.`
      : recentSlHits > 0
        ? `Guardrail clear: ${recentSlHits} recent SL, below limit ${RECENT_SL_GUARDRAIL_LIMIT}.`
        : "Guardrail clear: no recent SL streak.",
  };
}

export function patternAdjustmentFromRow(
  row: PatternOutcomeRow | undefined,
  maxAdjustment: number,
  guardrail?: PatternLearningGuardrail,
  scope: "pattern" | "regime" = "pattern"
): PatternConfidenceAdjustment {
  const cap = capValue(maxAdjustment);
  if (!row || cap <= 0) {
    return {
      adjustment: 0,
      sample: 0,
      winRate: null,
      avgR: null,
      reason: "No adjustment.",
      regime: row?.regime,
      scope,
      guardrailActive: guardrail?.active,
      recentSlHits: guardrail?.recentSlHits,
    };
  }

  if (row.closed < MIN_CLOSED_SAMPLE) {
    return {
      adjustment: 0,
      sample: row.closed,
      winRate: null,
      avgR: row.avgR,
      reason: `Need ${MIN_CLOSED_SAMPLE} closed outcomes.`,
      regime: row.regime,
      scope,
      guardrailActive: guardrail?.active,
      recentSlHits: guardrail?.recentSlHits,
    };
  }

  const winRate = row.wins / row.closed;
  const avgR = row.avgR ?? 0;
  const raw = ((winRate - 0.5) * 20) + (avgR * 4);
  const rounded = Math.round(clamp(raw, -cap, cap));
  const computedAdjustment = Math.abs(rounded) < 2 ? 0 : rounded;
  const adjustment = guardrail?.active && computedAdjustment > 0 ? 0 : computedAdjustment;
  const reason = adjustment > 0
    ? `${scope === "regime" ? `${row.regime} regime` : "Pattern"} performing well: ${Math.round(winRate * 100)}% win, ${avgR.toFixed(2)}R.`
    : guardrail?.active && computedAdjustment > 0
      ? `${guardrail.reason} Positive boost blocked.`
    : adjustment < 0
      ? `${scope === "regime" ? `${row.regime} regime` : "Pattern"} underperforming: ${Math.round(winRate * 100)}% win, ${avgR.toFixed(2)}R.`
      : `${scope === "regime" ? `${row.regime} regime` : "Pattern"} neutral: ${Math.round(winRate * 100)}% win, ${avgR.toFixed(2)}R.`;

  return {
    adjustment,
    sample: row.closed,
    winRate,
    avgR,
    reason,
    regime: row.regime,
    scope,
    guardrailActive: guardrail?.active,
    recentSlHits: guardrail?.recentSlHits,
  };
}

export async function getPatternConfidenceAdjustment(
  pattern: string | undefined,
  decisions: BotDecisionLog[],
  maxAdjustment: number,
  regime?: string
): Promise<PatternConfidenceAdjustment> {
  if (!pattern || pattern === "No clear candle pattern") {
    return { adjustment: 0, sample: 0, winRate: null, avgR: null, reason: "No pattern adjustment." };
  }

  try {
    const outcomes = await loadPaperOutcomes();
    if (regime) {
      const regimeSummary = summarizePatternOutcomes(outcomes, decisions, { regime, keyByRegime: true });
      const regimeRow = regimeSummary.rows.find((candidate) => candidate.pattern === pattern && candidate.regime === regime);
      if (regimeRow && regimeRow.closed >= MIN_CLOSED_SAMPLE) {
        const regimeGuardrail = patternGuardrailFromOutcomes(pattern, outcomes, regime);
        return patternAdjustmentFromRow(regimeRow, maxAdjustment, regimeGuardrail, "regime");
      }
    }

    const summary = summarizePatternOutcomes(outcomes, decisions);
    const row = summary.rows.find((candidate) => candidate.pattern === pattern);
    const guardrail = patternGuardrailFromOutcomes(pattern, outcomes);
    return patternAdjustmentFromRow(row, maxAdjustment, guardrail, "pattern");
  } catch {
    return { adjustment: 0, sample: 0, winRate: null, avgR: null, reason: "Pattern outcomes unavailable." };
  }
}
