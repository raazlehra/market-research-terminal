import { getLotSizeFromSymbol } from "./utils";

export function formatWinRate(value: unknown) {
  const rate = Number(value || 0);
  const percent = rate <= 1 ? rate * 100 : rate;
  return `${percent.toFixed(1)}%`;
}

export function buildPaperWalletSummary(balance: any) {
  const b = balance ?? {};
  const openPnl = typeof b.unrealized === "number" ? b.unrealized : 0;
  const netPnl = typeof b.netPnl === "number" ? b.netPnl : openPnl;
  const totalCharges = typeof b.totalCharges === "number" ? b.totalCharges : 0;

  return {
    starting: b.starting,
    available: b.available,
    used: b.used,
    openPnl,
    netPnl,
    totalCharges,
  };
}

export function openPaperPositions(rows: any[]) {
  return (rows ?? []).filter((p: any) => Math.abs(p.qty ?? p.openQty ?? 0) > 0 && Math.abs(p.openQty ?? p.qty ?? 0) > 0);
}

export function isCashEquitySymbol(symbolValue: unknown) {
  const symbol = String(symbolValue || "").toUpperCase();
  return symbol.endsWith("-EQ");
}

export function isDerivativePosition(pos: any) {
  const symbol = String(pos?.symbol || "").toUpperCase();
  if (isCashEquitySymbol(symbol)) return false;
  const lotSize = getLotSizeFromSymbol(pos?.symbol);
  return lotSize > 1 || symbol.endsWith("CE") || symbol.endsWith("PE") || /\b(CALL|PUT)\b/.test(symbol);
}

export function splitPaperPositions(positions: any[]) {
  return {
    equityPositions: positions.filter((pos) => !isDerivativePosition(pos)),
    derivativePositions: positions.filter(isDerivativePosition),
  };
}

export function buildQtyOptions(qty: number) {
  const options = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000].filter((n) => n <= qty);
  if (!options.includes(qty)) options.push(qty);
  return options;
}

export function selectedOutcomeBucket(outcomeSummaryData: any, selectedBucketLabel: string) {
  const buckets: any[] = outcomeSummaryData?.buckets || [];
  const selectedBucket = buckets.find((bucket: any) => (bucket.bucket || bucket.confidenceBucket) === selectedBucketLabel) || buckets[0];
  const selectedLabel = selectedBucket?.bucket || selectedBucket?.confidenceBucket || selectedBucketLabel;
  return { buckets, selectedBucket, selectedLabel };
}
