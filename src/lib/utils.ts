import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function inr(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return "₹0.00";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(val);
}

export function num(val: number | null | undefined, decimals = 2): string {
  if (val === null || val === undefined || isNaN(val)) return "0";
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: decimals,
  }).format(val);
}

export function pct(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return "0.0%";
  const prefix = val > 0 ? "+" : "";
  return `${prefix}${val.toFixed(2)}%`;
}

export function fmtTime(val: string | number | Date | null | undefined): string {
  if (!val) return "—";
  try {
    const d = new Date(val);
    return d.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

const marketHolidays = new Set([
  "2026-03-04", // Holi
  "2026-05-28", // Eid (example)
]);

export function getIndiaTime(date = new Date()): Date {
  return new Date(
    date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  );
}

export function getMarketStatus(date = new Date()) {
  const now = getIndiaTime(date);
  const day = now.getDay();
  const hh = now.getHours();
  const mm = now.getMinutes();
  const today = `${now.getFullYear().toString().padStart(4, "0")}-${(now.getMonth() + 1)
    .toString()
    .padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}`;
  const mins = hh * 60 + mm;

  if (day === 0 || day === 6) {
    return { isOpen: false, reason: "Weekend" };
  }

  if (marketHolidays.has(today)) {
    return { isOpen: false, reason: "Market holiday" };
  }

  if (mins < 555) {
    return { isOpen: false, reason: "Market opens at 09:15 IST" };
  }

  if (mins > 930) {
    return { isOpen: false, reason: "Market closed at 15:30 IST" };
  }

  return { isOpen: true, reason: "Open" };
}

export function isMarketOpen(date = new Date()) {
  return getMarketStatus(date).isOpen;
}

export function signColor(val: number | null | undefined): string {
  if (!val) return "text-slate-400";
  return val > 0 ? "text-emerald-400" : val < 0 ? "text-rose-400" : "text-slate-400";
}

export function getLotSizeFromSymbol(symbol: string | undefined | null): number {
  if (!symbol) return 1;
  const normalized = symbol.toUpperCase();

  if (normalized.includes("BANKNIFTY")) return 15;
  if (normalized.includes("FINNIFTY")) return 40;
  if (normalized.includes("MIDCPNIFTY")) return 50;
  if (normalized.includes("SENSEX")) return 10;
  if (normalized.includes("NIFTY") && !normalized.includes("FINNIFTY") && !normalized.includes("MIDCPNIFTY") && !normalized.includes("BANKNIFTY")) return 25;

  if (normalized.includes("NSE:NIFTY50-INDEX")) return 25;
  if (normalized.includes("NSE:NIFTYBANK-INDEX")) return 15;
  if (normalized.includes("NSE:FINNIFTY-INDEX")) return 40;
  if (normalized.includes("NSE:MIDCPNIFTY-INDEX")) return 50;
  if (normalized.includes("NSE:SENSEX-INDEX")) return 10;

  return 1;
}
