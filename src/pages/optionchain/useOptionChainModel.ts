import { useEffect, useMemo, useState } from "react";
import type { ExpiryRecord, OptionChainResponse, OptionChainRow } from "../../lib/api";
import { useExpiries, useOptionChain } from "../../hooks";
import { evaluateChartRules } from "../../lib/chartRules";
import { evaluateExpiryRules } from "../../lib/expiryRules";
import { evaluateOptionLiquidity } from "../../lib/liquidityRules";
import { buildOptionChainSnapshot } from "../../lib/optionChainModel";

export function useOptionChainModel() {
  const [index, setIndexRaw] = useState("NSE:NIFTY50-INDEX");
  const [expiry, setExpiry] = useState<string | undefined>(undefined);
  const [radius, setRadius] = useState(500);
  const [minOI, setMinOI] = useState(0);
  const [selectedRow, setSelectedRow] = useState<OptionChainRow | null>(null);

  const expiriesData = useExpiries(index);
  const expiries: ExpiryRecord[] = expiriesData.data ?? [];
  const selectedExpiry = expiry || (expiries[0]?.expiry != null ? String(expiries[0].expiry) : undefined);
  const selectedExpiryMeta = expiries.find((item) => String(item.expiry) === selectedExpiry);

  const selectedExpiryDate = useMemo(() => {
    if (!selectedExpiry) return null;
    const normalized = String(selectedExpiry).trim();
    if (/^\d+$/.test(normalized)) {
      const numericExpiry = Number(normalized);
      return new Date(numericExpiry > 9999999999 ? numericExpiry : numericExpiry * 1000);
    }
    return /^\d{4}-\d{2}-\d{2}$/.test(normalized)
      ? new Date(`${normalized}T23:59:59`)
      : new Date(normalized);
  }, [selectedExpiry]);

  const timeToExpiryYears = useMemo(() => {
    if (!selectedExpiryDate) return 30 / 365;
    const millis = selectedExpiryDate.getTime() - Date.now();
    return Math.max(millis / (365 * 24 * 60 * 60 * 1000), 0.001);
  }, [selectedExpiryDate]);

  const chain = useOptionChain(index, selectedExpiry);
  const data = (chain.data ?? {}) as Partial<OptionChainResponse>;
  const rows: OptionChainRow[] = data.chain ?? [];
  const spot = data.spot ?? 0;

  const snapshot = useMemo(
    () => buildOptionChainSnapshot({ data, rows, spot, timeToExpiryYears }),
    [data, rows, spot, timeToExpiryYears]
  );

  useEffect(() => {
    setSelectedRow(null);
  }, [index, selectedExpiry]);

  const expiryRule = evaluateExpiryRules({
    expiry: selectedExpiry,
    expiryLabel: selectedExpiryMeta?.date,
    bid: snapshot.recommendedOption?.option?.bid,
    ask: snapshot.recommendedOption?.option?.ask,
    ltp: snapshot.recommendedEntryPrice,
    volume: snapshot.recommendedOption?.option?.volume,
    oi: snapshot.recommendedOption?.option?.oi,
    confidence: snapshot.confluenceScore,
    side: snapshot.recommendedOption?.side,
    bias: snapshot.bias,
  });
  const liquidityRule = evaluateOptionLiquidity({
    bid: snapshot.recommendedOption?.option?.bid,
    ask: snapshot.recommendedOption?.option?.ask,
    ltp: snapshot.recommendedEntryPrice,
    volume: snapshot.recommendedOption?.option?.volume,
    oi: snapshot.recommendedOption?.option?.oi,
  });

  const chartRule = evaluateChartRules({
    side: snapshot.recommendedOption?.side,
    spot,
    vwap: snapshot.vwap,
    ema20: snapshot.ema20,
    ema50: snapshot.ema50,
    vwap15: data.vwap15 ?? null,
    ema2015: data.ema2015 ?? null,
    ema5015: data.ema5015 ?? null,
    vwap60: data.vwap60 ?? null,
    ema2060: data.ema2060 ?? null,
    ema5060: data.ema5060 ?? null,
    support: data.analysis?.timeframes?.["5"]?.support ?? snapshot.s1,
    resistance: data.analysis?.timeframes?.["5"]?.resistance ?? snapshot.r1,
    rsi5: data.analysis?.timeframes?.["5"]?.rsi14,
    rsi15: data.analysis?.timeframes?.["15"]?.rsi14,
    rsi60: data.analysis?.timeframes?.["60"]?.rsi14,
    candleDirection: data.analysis?.timeframes?.["5"]?.candle_direction,
    candleConfirmed: data.analysis?.timeframes?.["5"]?.candle_confirmed,
    analysisFresh: data.analysis?.overall?.fresh,
    timeframesAvailable: data.analysis?.overall?.timeframes_available,
  });

  function setIndex(value: string) {
    setIndexRaw(value);
    setExpiry(undefined);
  }

  return {
    ...snapshot,
    chain,
    chartRule,
    expiries,
    expiry: selectedExpiry,
    expiryRule,
    liquidityRule,
    index,
    minOI,
    radius,
    rows,
    selectedRow,
    setExpiry,
    setIndex,
    setMinOI,
    setRadius,
    setSelectedRow,
    spot,
  };
}
