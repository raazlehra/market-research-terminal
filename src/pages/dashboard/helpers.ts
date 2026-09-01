export const TOP_INDEXES = [
  { symbol: "NSE:NIFTY50-INDEX", label: "NIFTY 50", fallbackLtp: 23622.9, fallbackChp: 1.99 },
  { symbol: "NSE:NIFTYBANK-INDEX", label: "NIFTY BANK", fallbackLtp: 56814.8, fallbackChp: 2.97 },
  { symbol: "NSE:FINNIFTY-INDEX", label: "FINNIFTY", fallbackLtp: 25943.35, fallbackChp: 3.15 },
  { symbol: "NSE:MIDCPNIFTY-INDEX", label: "MIDCAP NIFTY", fallbackLtp: 14245.6, fallbackChp: 2.73 },
];

export function toNumber(value: any, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function asList(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.positions)) return data.positions;
  if (Array.isArray(data?.trades)) return data.trades;
  if (Array.isArray(data?.orders)) return data.orders;
  if (Array.isArray(data?.orderBook)) return data.orderBook;
  if (Array.isArray(data?.tradeBook)) return data.tradeBook;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export function itemTime(item: any) {
  return item?.time || item?.created_at || item?.createdAt || item?.filled_at || item?.filledAt || item?.tradeDate || item?.orderDateTime;
}

export function isToday(item: any) {
  const raw = itemTime(item);
  if (!raw) return false;
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return false;
  return dt.toDateString() === new Date().toDateString();
}

export function positionPnl(p: any) {
  return toNumber(p?.pl ?? p?.pnl ?? p?.unrealized ?? p?.unrealizedPnl ?? p?.netPnL ?? p?.net_pnl);
}

export function positionQty(p: any) {
  return toNumber(p?.qty ?? p?.netQty ?? p?.quantity ?? p?.open_qty);
}

export function tradeSymbol(t: any) {
  return t?.symbol || t?.tradingSymbol || t?.symbolName || "-";
}

export function tradeSide(t: any) {
  return t?.side || t?.transactionType || t?.buySell || "-";
}

export function tradePrice(t: any) {
  return toNumber(t?.price ?? t?.tradePrice ?? t?.avg_price ?? t?.averagePrice);
}

export function queryIssue(...queries: { isLoading?: boolean; isError?: boolean }[]) {
  if (queries.some((q) => q.isLoading)) return "Loading";
  if (queries.some((q) => q.isError)) return "Data unavailable";
  return null;
}

