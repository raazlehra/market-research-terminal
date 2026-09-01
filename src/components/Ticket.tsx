import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useMarket, useSettings, useTicket } from "../stores";
import { api } from "../lib/api";
import { fmtTime, getLotSizeFromSymbol, inr, isMarketOpen } from "../lib/utils";
import { InfoCard, PnlPanel, RiskPanel } from "./ticket/TicketPanels";

export function Ticket() {
  const { isOpen, params, close } = useTicket();
  const qc = useQueryClient();
  const market = useMarket();
  const settings = useSettings();

  const [lotSize, setLotSize] = useState(params.lotSize || getLotSizeFromSymbol(params.symbol));
  const [lots, setLots] = useState(Math.max(1, Math.ceil((params.qty || 1) / lotSize)));
  const [price, setPrice] = useState(params.price || 0);
  const [orderType, setOrderType] = useState(params.orderType || "MARKET");
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitCount, setSubmitCount] = useState(0);

  const qty = Math.max(0, lots * lotSize);
  const currentLtp = market.ticks[params.symbol]?.ltp ?? price;
  const entryPrice = orderType === "MARKET" ? currentLtp : price;
  const sl = params.sl ?? 0;
  const t1 = params.targets?.[0] ?? 0;
  const t2 = params.targets?.[1] ?? 0;
  const isBuy = params.side === "BUY";
  const effectiveSl = sl > 0
    ? sl
    : entryPrice > 0
      ? parseFloat((entryPrice * (isBuy ? 0.97 : 1.03)).toFixed(2))
      : 0;
  const effectiveT1 = t1 > 0
    ? t1
    : entryPrice > 0
      ? parseFloat((entryPrice * (isBuy ? 1.02 : 0.98)).toFixed(2))
      : 0;
  const effectiveT2 = t2 > 0
    ? t2
    : entryPrice > 0
      ? parseFloat((entryPrice * (isBuy ? 1.05 : 0.95)).toFixed(2))
      : 0;
  const riskPerLot = Math.max(0, isBuy ? entryPrice - effectiveSl : effectiveSl - entryPrice);
  const rewardT1PerLot = Math.max(0, isBuy ? effectiveT1 - entryPrice : entryPrice - effectiveT1);
  const rewardT2PerLot = Math.max(0, isBuy ? effectiveT2 - entryPrice : entryPrice - effectiveT2);
  const rr1 = riskPerLot ? rewardT1PerLot / riskPerLot : 0;
  const rr2 = riskPerLot ? rewardT2PerLot / riskPerLot : 0;
  const investment = entryPrice * qty;
  const maxRisk = riskPerLot * qty;
  const potentialT1 = rewardT1PerLot * qty;
  const potentialT2 = rewardT2PerLot * qty;
  const mtmPercent = entryPrice ? ((currentLtp - entryPrice) / entryPrice) * 100 : 0;

  const validationMessage = useMemo(() => {
    if (!isMarketOpen()) return "Market is closed. Orders can only be placed during trading hours.";
    if (!params.symbol) return "Symbol is required.";
    if (qty <= 0) return "Quantity must be greater than zero.";
    if (lotSize <= 0) return "Lot size must be configured.";
    if (qty % lotSize !== 0) return `Quantity must be a multiple of lot size (${lotSize}).`;
    if (entryPrice <= 0) return "Entry price must be positive.";
    if (effectiveSl <= 0) return "Stop loss must be positive.";
    if (!effectiveT1 || !effectiveT2) return "Both target levels must be set.";
    if (isBuy) {
      if (effectiveT1 <= entryPrice) return "Target 1 must be above entry for BUY trades.";
      if (effectiveT2 <= effectiveT1) return "Target 2 must be above Target 1 for BUY trades.";
      if (effectiveSl >= entryPrice) return "Stop loss must be below entry for BUY trades.";
    } else {
      if (effectiveT1 >= entryPrice) return "Target 1 must be below entry for SELL trades.";
      if (effectiveT2 >= effectiveT1) return "Target 2 must be below Target 1 for SELL trades.";
      if (effectiveSl <= entryPrice) return "Stop loss must be above entry for SELL trades.";
    }
    return null;
  }, [params.symbol, qty, lotSize, entryPrice, effectiveSl, effectiveT1, effectiveT2, isBuy]);

  useEffect(() => {
    if (!isOpen) return;
    const detectedLotSize = params.lotSize || getLotSizeFromSymbol(params.symbol);
    setLotSize(detectedLotSize || 1);
    setLots(Math.max(1, Math.ceil((params.qty || 1) / (detectedLotSize || 1))));
    setPrice(params.price ?? market.ticks[params.symbol]?.ltp ?? 0);
    setOrderType(params.orderType || "MARKET");
    setStatus(null);
    setIsSubmitting(false);
    setSubmitCount(0);
  }, [
    isOpen,
    params.symbol,
    params.side,
    params.qty,
    params.price,
    params.orderType,
    params.lotSize,
    params.product,
    params.exchange,
    params.validity,
    params.sl,
    params.targets,
    params.trailSl,
  ]);

  if (!isOpen) return null;

  async function executeOrder() {
    if (isSubmitting) return;

    if (validationMessage) {
      setStatus({ type: "error", message: validationMessage });
      return;
    }

    const newSubmitCount = submitCount + 1;
    setSubmitCount(newSubmitCount);
    if (newSubmitCount > 1) {
      setStatus({ type: "error", message: "Order submission is already in progress. Please try again." });
      return;
    }

    const payload = {
      symbol: params.symbol,
      side: params.side,
      qty,
      orderType,
      price: entryPrice,
      productType: params.product || settings.defaultProduct || "INTRADAY",
      exchange: params.exchange || settings.defaultExchange || "NSE",
      validity: params.validity || settings.defaultValidity || "DAY",
      signalTime: (params as any).signalTime || new Date().toISOString(),
      strategy: params.strategy || "Manual",
      confidence: params.confidence || 50,
      entry: entryPrice,
      sl: effectiveSl,
      t1: effectiveT1,
      t2: effectiveT2,
      lotSize,
      optionType: params.optionType,
      trailSl: params.trailSl,
    };
    try {
      setIsSubmitting(true);
      setStatus({ type: "success", message: "Submitting order..." });

      if (!payload.symbol) throw new Error("Symbol is missing");
      if (!payload.qty || payload.qty <= 0) throw new Error("Invalid quantity");

      const res = await api.placePaperOrder(payload);
      const accepted = Boolean(res?.ok);
      if (!accepted) {
        setStatus({ type: "error", message: res?.message || res?.s || "Order rejected by backend." });
        setIsSubmitting(false);
        return;
      }

      qc.invalidateQueries({ queryKey: ["paperOrders"] });
      qc.invalidateQueries({ queryKey: ["paperPositions"] });
      qc.invalidateQueries({ queryKey: ["paperTrades"] });
      qc.invalidateQueries({ queryKey: ["paperBalance"] });
      qc.invalidateQueries({ queryKey: ["paperOutcomeSummary"] });
      qc.invalidateQueries({ queryKey: ["paperOutcomes"] });
      qc.invalidateQueries({ queryKey: ["reports"] });

      setStatus({
        type: "success",
        message: `Paper order filled. Position opened. ${payload.side} ${payload.qty}x ${payload.symbol} @ ${inr(payload.price)}. SL: ${inr(payload.sl)}, T1: ${inr(payload.t1)}, T2: ${inr(payload.t2)}`,
      });

      setTimeout(() => {
        setIsSubmitting(false);
        close();
      }, 1200);
    } catch (err: any) {
      setIsSubmitting(false);
      setStatus({
        type: "error",
        message: err?.message || err?.toString() || "Order failed. Please check backend logs.",
      });
    }
  }

  const unitFieldLabel = lotSize > 1 ? "Lots" : "Units";
  const unitSingular = lotSize > 1 ? "LOT" : "UNIT";
  const buttonDisabled = Boolean(validationMessage) || isSubmitting;
  const buttonLabel = isSubmitting
    ? `SUBMITTING... - ${lots} ${unitSingular}${lots > 1 ? "S" : ""} - ${qty} QTY`
    : `CONFIRM PAPER ${params.side} - ${lots} ${unitSingular}${lots > 1 ? "S" : ""} - ${qty} QTY`;
  const signalTimeLabel = (params as any).signalTime ? fmtTime((params as any).signalTime) : fmtTime(new Date());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-auto rounded-3xl bg-slate-950 p-6 shadow-2xl shadow-black/40">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-slate-500">
              {params.product || settings.defaultProduct || "INTRADAY"} / {params.exchange || settings.defaultExchange || "NSE"} / {params.validity || settings.defaultValidity || "DAY"}
            </div>
            <h3 className="mt-1 text-2xl font-bold text-white">{params.symbol}</h3>
            <div className="mt-1 text-sm text-slate-400">{params.optionType ? `${params.optionType} Option` : "Equity / Index"}</div>
          </div>
          <span className="rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-[10px] font-black text-emerald-200">
            PAPER ONLY
          </span>
          <button onClick={close} className="rounded-full border border-slate-700 bg-slate-900 p-2 text-slate-400 transition hover:border-slate-500 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4 sm:col-span-2">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Lot Size</div>
                <div className="mt-2 font-semibold text-slate-100">{lotSize}</div>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-[0.3em] text-slate-500">{unitFieldLabel}</label>
                <input
                  type="number"
                  min={1}
                  value={lots}
                  onChange={(e) => {
                    const nextLots = Number.parseInt(e.target.value, 10);
                    setLots(Number.isFinite(nextLots) ? Math.max(1, nextLots) : 1);
                  }}
                  className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-white outline-none transition focus:border-indigo-500"
                />
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.3em] text-slate-500">Qty</div>
                <div className="mt-2 font-semibold text-slate-100">{qty}</div>
              </div>
            </div>
          </div>
          <InfoCard label="Entry Price" value={inr(entryPrice)} />
          <InfoCard label="Current LTP" value={inr(currentLtp)} tone={mtmPercent} />
          <InfoCard label="Confidence" value={`${params.confidence ?? 50}%`} />
          <InfoCard label="Strategy" value={params.strategy || "Manual"} />
          <InfoCard label="Signal Time" value={signalTimeLabel} />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <RiskPanel entryPrice={entryPrice} sl={effectiveSl} t1={effectiveT1} t2={effectiveT2} trailSl={params.trailSl} riskPerLot={riskPerLot} rewardT1PerLot={rewardT1PerLot} rewardT2PerLot={rewardT2PerLot} rr1={rr1} rr2={rr2} />
          <PnlPanel investment={investment} maxRisk={maxRisk} potentialT1={potentialT1} potentialT2={potentialT2} currentLtp={currentLtp} entryPrice={entryPrice} qty={qty} mtmPercent={mtmPercent} />
        </div>

        <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="grid gap-4">
            <div>
              <label className="block text-xs uppercase tracking-[0.3em] text-slate-500">Order Price</label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(parseFloat(e.target.value || "0"))}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none transition focus:border-indigo-500"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-slate-400">Order type:</div>
            <div className="flex gap-2">
              {(["MARKET", "LIMIT"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setOrderType(type)}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${orderType === type ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        </div>

        {status ? (
          <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${status.type === "success" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-rose-500/30 bg-rose-500/10 text-rose-200"}`}>
            {status.message}
          </div>
        ) : validationMessage ? (
          <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {validationMessage}
          </div>
        ) : null}

        <div className="mt-5">
          <button
            onClick={(e) => {
              e.preventDefault();
              executeOrder();
            }}
            disabled={buttonDisabled}
            className={`w-full rounded-2xl px-5 py-3 text-sm font-bold transition ${buttonDisabled ? "cursor-not-allowed bg-slate-700 text-slate-400" : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"}`}
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Ticket;
