import { useEffect, useMemo, useState } from "react";
import type { ExpiryRecord, OptionChainResponse, OptionChainRow } from "../../lib/api";
import { useExpiries, useOptionChain } from "../../hooks";
import { evaluateChartRules } from "../../lib/chartRules";
import { evaluateExpiryRules } from "../../lib/expiryRules";
import { evaluateOptionLiquidity } from "../../lib/liquidityRules";
import { buildOptionChainSnapshot, OPTION_INDEXES } from "../../lib/optionChainModel";
import { openOptionFor } from "../../lib/optionChainAnalytics";
import { useAutoBot } from "../../stores";

export function useOptionChainModel() {
  const [index, setIndexRaw] = useState("NSE:NIFTY50-INDEX");
  const [expiry, setExpiry] = useState<string | undefined>(undefined);
  const [radius, setRadius] = useState(500);
  const [minOI, setMinOI] = useState(0);
  const [selectedRow, setSelectedRow] = useState<OptionChainRow | null>(null);
  const [paperLots, setPaperLots] = useState(1);
  const [autoBotMessage, setAutoBotMessage] = useState("");
  const [autoBotBusy, setAutoBotBusy] = useState(false);
  const bot = useAutoBot();

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
  const selectedIndex = OPTION_INDEXES.find((item) => item.value === index);
  const lotSize = selectedIndex?.lot ?? 75;

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

  function openRecommendedTicket(side: "CE" | "PE", candidate: typeof snapshot.recommendedOption) {
    if (!candidate) {
      alert("No eligible contract candidate is available yet.");
      return;
    }

    const symbol = candidate.option?.symbol || candidate.row?.ce?.symbol || candidate.row?.pe?.symbol || "";
    const entryPrice = candidate.option?.ltp ?? candidate.option?.ask ?? 0;

    if (!symbol || entryPrice <= 0) {
      alert("Contract data is incomplete and cannot be staged.");
      return;
    }

    if (!expiryRule.tradeable || !liquidityRule.tradeable || !chartRule.tradeable || snapshot.confluenceScore < 65) {
      alert("This candidate is blocked by the expiry, liquidity, chart, or confidence safety checks.");
      return;
    }

    openOptionFor({
      symbol,
      side,
      lotSize: lotSize * paperLots,
      price: entryPrice,
      confidence: Math.max(50, Math.round(snapshot.confluenceScore)),
      extra: { targets: [snapshot.recommendedT1, snapshot.recommendedT2], sl: snapshot.recommendedSL },
    });
  }

  async function triggerAutoBotOption() {
    if (!snapshot.recommendedOption) {
      setAutoBotMessage("No eligible option candidate is available yet.");
      return;
    }

    const option = snapshot.recommendedOption.option;
    const symbol = option?.symbol || snapshot.recommendedOption.row?.ce?.symbol || snapshot.recommendedOption.row?.pe?.symbol || "";
    const entryPrice = option?.ltp ?? option?.ask ?? 0;

    setAutoBotBusy(true);
    setAutoBotMessage("Checking option Auto-Bot rules...");
    try {
      const accepted = await bot.triggerOptionChainTrade({
        symbol,
        optionSide: snapshot.recommendedOption.side,
        lotSize,
        requestedLots: paperLots,
        price: entryPrice,
        sl: snapshot.recommendedSL,
        t1: snapshot.recommendedT1,
        t2: snapshot.recommendedT2,
        confidence: snapshot.confluenceScore,
        bias: snapshot.bias,
        strike: snapshot.recommendedOption.row?.strike,
        expiry: selectedExpiry,
        expiryLabel: selectedExpiryMeta?.date,
        bid: option?.bid,
        ask: option?.ask,
        volume: option?.volume,
        oi: option?.oi,
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
        support: snapshot.s1,
        resistance: snapshot.r1,
      });
      setAutoBotMessage(accepted ? "Option Auto-Bot order submitted." : useAutoBot.getState().lastAction);
    } catch (error: any) {
      setAutoBotMessage(`Option Auto-Bot failed: ${error?.message || "unable to run test"}.`);
    } finally {
      setAutoBotBusy(false);
    }
  }

  return {
    ...snapshot,
    autoBotBusy,
    autoBotMessage,
    chain,
    chartRule,
    expiries,
    expiry: selectedExpiry,
    expiryRule,
    liquidityRule,
    index,
    lotSize,
    minOI,
    paperLots,
    radius,
    rows,
    selectedRow,
    setExpiry,
    setIndex,
    setMinOI,
    setPaperLots,
    setRadius,
    setSelectedRow,
    spot,
    openRecommendedTicket,
    triggerAutoBotOption,
  };
}
