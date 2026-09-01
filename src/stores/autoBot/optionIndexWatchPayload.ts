export type OptionQuote = {
  bid?: number;
  ask?: number;
  ltp?: number;
  volume?: number;
  oi?: number;
  symbol?: string;
};

type ExpiryRow = {
  expiry?: string;
  date?: string;
};

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function optionSymbol(option: unknown, row: unknown) {
  const optionRow = asRecord(option);
  const strikeRow = asRecord(row);
  const ce = asRecord(strikeRow.ce);
  const pe = asRecord(strikeRow.pe);
  return String(optionRow.symbol || ce.symbol || pe.symbol || "");
}

export function expiryRows(payload: unknown): ExpiryRow[] {
  const rows = Array.isArray(payload) ? payload : asRecord(payload).data;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const record = asRecord(row);
    return {
      expiry: textValue(record.expiry),
      date: textValue(record.date),
    };
  });
}

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
