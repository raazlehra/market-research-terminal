import type { BotDecisionLog } from "./types";
import { writeDecisionLog } from "./storage";

export function createDecisionLogEntry(entry: Omit<BotDecisionLog, "id" | "time">): BotDecisionLog {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: new Date().toISOString(),
    ...entry,
  };
}

export function persistNextDecisionLog(current: BotDecisionLog[], row: BotDecisionLog) {
  const next = [row, ...current].slice(0, 50);
  writeDecisionLog(next);
  return next;
}
