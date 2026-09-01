const SIGNAL_STABILITY_KEY = "fyers_auto_bot_signal_stability";
const DEFAULT_REQUIRED_HITS = 2;
const DEFAULT_MAX_AGE_MS = 2 * 60 * 1000;

type SignalRecord = {
  key: string;
  hits: number;
  lastSeenAt: number;
};

function readRecords(): Record<string, SignalRecord> {
  if (typeof sessionStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SIGNAL_STABILITY_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeRecords(records: Record<string, SignalRecord>) {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(SIGNAL_STABILITY_KEY, JSON.stringify(records));
}

function prune(records: Record<string, SignalRecord>, maxAgeMs: number) {
  const now = Date.now();
  return Object.fromEntries(Object.entries(records).filter(([, record]) => now - record.lastSeenAt <= maxAgeMs));
}

export function confirmSignalStability(params: {
  key: string;
  label: string;
  requiredHits?: number;
  maxAgeMs?: number;
}) {
  const requiredHits = Math.max(1, params.requiredHits ?? DEFAULT_REQUIRED_HITS);
  const maxAgeMs = params.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const records = prune(readRecords(), maxAgeMs);
  const previous = records[params.key];
  const now = Date.now();
  const hits = previous ? previous.hits + 1 : 1;

  records[params.key] = { key: params.key, hits, lastSeenAt: now };
  writeRecords(records);

  return {
    stable: hits >= requiredHits,
    hits,
    requiredHits,
    message: hits >= requiredHits
      ? `${params.label} stable for ${hits}/${requiredHits} scans.`
      : `${params.label} needs confirmation (${hits}/${requiredHits} scans).`,
  };
}
