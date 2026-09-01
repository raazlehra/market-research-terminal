import { localDayKey } from "./storage";

const BOT_COOLDOWN_KEY = "fyers_auto_bot_cooldowns";
const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;
const REPEATED_SL_LIMIT = 2;

export type CooldownRecord = {
  key: string;
  symbol: string;
  side: "BUY" | "SELL";
  strategy: string;
  source?: "scanner" | "tick" | "option_chain";
  lastSlAt: number;
  blockedUntil: number;
  day: string;
  slCount: number;
};

export type ActiveCooldown = CooldownRecord & {
  remainingMinutes: number;
  repeated: boolean;
  message: string;
};

function normalize(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function cooldownKey(symbol: string, side: "BUY" | "SELL", strategy: string) {
  return `${normalize(strategy)}::${normalize(symbol)}::${side}`;
}

function endOfLocalDayMs() {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end.getTime();
}

function readCooldowns(): Record<string, CooldownRecord> {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(BOT_COOLDOWN_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeCooldowns(value: Record<string, CooldownRecord>) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(BOT_COOLDOWN_KEY, JSON.stringify(value));
}

function pruneCooldowns(records: Record<string, CooldownRecord>) {
  const now = Date.now();
  const today = localDayKey();
  return Object.fromEntries(
    Object.entries(records).filter(([, record]) => record.day === today || record.blockedUntil > now)
  );
}

export function registerSlCooldown(params: {
  symbol: string;
  side: "BUY" | "SELL";
  strategy: string;
  source?: "scanner" | "tick" | "option_chain";
  cooldownMs?: number;
}) {
  const records = pruneCooldowns(readCooldowns());
  const key = cooldownKey(params.symbol, params.side, params.strategy);
  const now = Date.now();
  const today = localDayKey();
  const previous = records[key];
  const slCount = previous?.day === today ? Number(previous.slCount || 0) + 1 : 1;
  const blockedUntil = slCount >= REPEATED_SL_LIMIT
    ? endOfLocalDayMs()
    : now + (params.cooldownMs ?? DEFAULT_COOLDOWN_MS);

  records[key] = {
    key,
    symbol: params.symbol,
    side: params.side,
    strategy: params.strategy,
    source: params.source,
    lastSlAt: now,
    blockedUntil,
    day: today,
    slCount,
  };
  writeCooldowns(records);
  return records[key];
}

export function getCooldownBlock(params: {
  symbol: string;
  side: "BUY" | "SELL";
  strategy: string;
}) {
  const records = pruneCooldowns(readCooldowns());
  writeCooldowns(records);

  const record = records[cooldownKey(params.symbol, params.side, params.strategy)];
  if (!record || record.blockedUntil <= Date.now()) return null;

  return formatActiveCooldown(record, params.symbol, params.side);
}

function formatActiveCooldown(record: CooldownRecord, symbol = record.symbol, side = record.side): ActiveCooldown {
  const remainingMinutes = Math.max(1, Math.ceil((record.blockedUntil - Date.now()) / 60000));
  const repeated = record.slCount >= REPEATED_SL_LIMIT;
  return {
    ...record,
    remainingMinutes,
    repeated,
    message: repeated
      ? `Blocked: ${symbol} ${side} is locked for today after ${record.slCount} SL exits.`
      : `Blocked: ${symbol} ${side} is cooling down for ${remainingMinutes} min after SL.`,
  };
}

export function getActiveCooldowns() {
  const records = pruneCooldowns(readCooldowns());
  writeCooldowns(records);
  return Object.values(records)
    .filter((record) => record.blockedUntil > Date.now())
    .map((record) => formatActiveCooldown(record))
    .sort((a, b) => b.blockedUntil - a.blockedUntil);
}
