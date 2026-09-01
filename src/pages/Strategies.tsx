import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import { Plus, ShieldCheck, Trash2, Wrench } from "lucide-react";
import { useExpiries, useOptionChain } from "../hooks";
import { api } from "../lib/api";
import {
  INDEX_SYMBOLS,
  STRATEGIES,
  buildStrategySymbol,
  hasUncoveredShort,
  makeStrategyLeg,
  payoffPoints,
  type StrategyLeg,
} from "../lib/strategyLab";
import { getLotSizeFromSymbol, inr, signColor } from "../lib/utils";

export default function Strategies() {
  const queryClient = useQueryClient();
  const [strategy, setStrategy] = useState("LONG_STRANGLE");
  const [underlying, setUnderlying] = useState("NIFTY");
  const [expiry, setExpiry] = useState<string | undefined>(undefined);
  const [spot, setSpot] = useState(23600);
  const [maxLossCap, setMaxLossCap] = useState(3000);
  const [paperMessage, setPaperMessage] = useState("");
  const [legs, setLegs] = useState<StrategyLeg[]>([
    makeStrategyLeg("NIFTY", "BUY", 25, 23700, "CE", 60),
    makeStrategyLeg("NIFTY", "BUY", 25, 23500, "PE", 55),
  ]);

  const indexSymbol = INDEX_SYMBOLS[underlying.toUpperCase()] || INDEX_SYMBOLS.NIFTY;
  const lotSize = getLotSizeFromSymbol(indexSymbol);
  const expiriesData: any = useExpiries(indexSymbol);
  const expiries = Array.isArray(expiriesData) ? expiriesData : expiriesData?.data ?? [];
  const selectedExpiry = expiry || expiries[0]?.expiry;
  const chain = useOptionChain(indexSymbol, selectedExpiry);
  const optionRows: any[] = chain.data?.chain ?? [];
  const strikeStep = Number(chain.data?.step ?? 50) || 50;

  const resolvedLegs = useMemo(() => {
    return legs.map((leg) => {
      const row = optionRows.find((item) => Number(item?.strike) === Number(leg.strike));
      const option = leg.type === "CE" ? row?.ce : row?.pe;
      return {
        ...leg,
        resolvedSymbol: String(option?.symbol || ""),
        livePremium: Number(option?.ltp ?? option?.ask ?? 0),
      };
    });
  }, [legs, optionRows]);

  const selectedStrategy = STRATEGIES.find((s) => s.v === strategy);
  const chartData = useMemo(() => payoffPoints(legs, spot), [legs, spot]);
  const maxProfit = Math.max(...chartData.map((p) => p.pnl));
  const maxLoss = Math.min(...chartData.map((p) => p.pnl));
  const riskAmount = Math.abs(Math.min(maxLoss, 0));
  const breakeven = chartData
    .filter((p, i) => i > 0 && chartData[i - 1].pnl * p.pnl < 0)
    .map((p) => p.spot);
  const definedRisk = strategy !== "CUSTOM" || !hasUncoveredShort(legs);
  const withinRisk = riskAmount <= maxLossCap;
  const unresolvedLegs = resolvedLegs.filter((leg) => !leg.resolvedSymbol);
  const canPaperPlace = definedRisk && withinRisk && legs.length > 0 && unresolvedLegs.length === 0 && legs.every((leg) => leg.qty > 0 && leg.qty % lotSize === 0 && leg.premium > 0 && leg.strike > 0);

  const paperPlace = useMutation({
    mutationFn: async () => {
      const placed = [];
      for (const leg of resolvedLegs) {
        if (!leg.resolvedSymbol) {
          throw new Error(`No live option symbol found for ${underlying} ${leg.strike}${leg.type}.`);
        }
        const result = await api.placePaperOrder({
          symbol: leg.resolvedSymbol,
          side: leg.side,
          qty: leg.qty,
          orderType: "MARKET",
          productType: "INTRADAY",
          premium: leg.premium,
          entry: leg.premium,
          strategy: selectedStrategy?.label || "Paper Strategy",
          confidence: withinRisk ? 80 : 50,
          notes: `Paper strategy leg: ${strategy} ${leg.symbol}`,
        });
        placed.push(result);
      }
      localStorage.setItem("paper_strategy_last", JSON.stringify({
        strategy,
        underlying,
        expiry: selectedExpiry,
        spot,
        maxLossCap,
        legs: resolvedLegs,
        placedAt: new Date().toISOString(),
      }));
      return placed;
    },
    onSuccess: (placed) => {
      setPaperMessage(`Paper strategy placed with ${placed.length} leg${placed.length === 1 ? "" : "s"}.`);
      queryClient.invalidateQueries({ queryKey: ["paperOrders"] });
      queryClient.invalidateQueries({ queryKey: ["paperPositions"] });
      queryClient.invalidateQueries({ queryKey: ["paperTrades"] });
      queryClient.invalidateQueries({ queryKey: ["paperBalance"] });
      queryClient.invalidateQueries({ queryKey: ["paperOutcomeSummary"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
    onError: (error: any) => {
      setPaperMessage(error?.message || "Paper strategy placement failed. Check backend auth and paper wallet.");
    },
  });

  function updateLeg(index: number, patch: Partial<StrategyLeg>) {
    setLegs((current) =>
      current.map((leg, i) => {
        if (i !== index) return leg;
        const next = { ...leg, ...patch };
        return { ...next, symbol: buildStrategySymbol(underlying, next.strike, next.type) };
      })
    );
  }

  function addLeg() {
    setLegs((current) => [...current, makeStrategyLeg(underlying, "BUY", 25, Math.round(spot / 50) * 50, "CE", 50)]);
  }

  function removeLeg(index: number) {
    setLegs((current) => current.filter((_, i) => i !== index));
  }

  function loadPreset(nextStrategy = strategy) {
    const atm = Math.round(spot / 50) * 50;
    const presets: Record<string, StrategyLeg[]> = {
      LONG_CALL: [makeStrategyLeg(underlying, "BUY", 25, atm, "CE", 120)],
      LONG_PUT: [makeStrategyLeg(underlying, "BUY", 25, atm, "PE", 115)],
      LONG_STRADDLE: [
        makeStrategyLeg(underlying, "BUY", 25, atm, "CE", 60),
        makeStrategyLeg(underlying, "BUY", 25, atm, "PE", 55),
      ],
      LONG_STRANGLE: [
        makeStrategyLeg(underlying, "BUY", 25, atm + 100, "CE", 60),
        makeStrategyLeg(underlying, "BUY", 25, atm - 100, "PE", 55),
      ],
      BULL_CALL_SPREAD: [
        makeStrategyLeg(underlying, "BUY", 25, atm, "CE", 120),
        makeStrategyLeg(underlying, "SELL", 25, atm + 100, "CE", 60),
      ],
      BEAR_PUT_SPREAD: [
        makeStrategyLeg(underlying, "BUY", 25, atm, "PE", 115),
        makeStrategyLeg(underlying, "SELL", 25, atm - 100, "PE", 55),
      ],
      CALL_BACKSPREAD: [
        makeStrategyLeg(underlying, "SELL", 25, atm, "CE", 120),
        makeStrategyLeg(underlying, "BUY", 50, atm + 100, "CE", 80),
      ],
      PUT_BACKSPREAD: [
        makeStrategyLeg(underlying, "SELL", 25, atm, "PE", 115),
        makeStrategyLeg(underlying, "BUY", 50, atm - 100, "PE", 75),
      ],
    };

    if (nextStrategy !== "CUSTOM") {
      setLegs(presets[nextStrategy] || []);
    }
  }

  function handleStrategyChange(value: string) {
    setStrategy(value);
    loadPreset(value);
  }

  function handleUnderlyingChange(value: string) {
    const nextUnderlying = value.toUpperCase();
    setUnderlying(nextUnderlying);
    setExpiry(undefined);
    setLegs((current) => current.map((leg) => ({ ...leg, symbol: buildStrategySymbol(nextUnderlying, leg.strike, leg.type) })));
  }

  return (
    <div className="p-5 animate-in fade-in duration-200">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Wrench className="h-5 w-5 text-indigo-400" /> Paper Strategy Lab
          </h1>
          <p className="text-sm text-slate-500">Defined-risk option payoff testing before paper execution.</p>
        </div>
        <span className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-300">
          Paper only
        </span>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="mb-2 text-xs font-bold text-slate-300">Defined-Risk Preset</div>
            <select
              value={strategy}
              onChange={(e) => handleStrategyChange(e.target.value)}
              className="mb-3 w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none"
            >
              {STRATEGIES.map((s) => (
                <option key={s.v} value={s.v}>{s.label}</option>
              ))}
            </select>
            <p className="mb-3 text-xs text-slate-500">{selectedStrategy?.desc}</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label>
                <span className="text-[10px] text-slate-500 block mb-1">Underlying</span>
                <input value={underlying} onChange={(e) => handleUnderlyingChange(e.target.value)} className="w-full rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-white outline-none" />
              </label>
              <label>
                <span className="text-[10px] text-slate-500 block mb-1">Spot Price</span>
                <input type="number" value={spot} onChange={(e) => setSpot(Number(e.target.value) || 0)} className="w-full rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-white outline-none" />
              </label>
              <label className="col-span-2">
                <span className="text-[10px] text-slate-500 block mb-1">Expiry</span>
                <select
                  value={selectedExpiry ?? ""}
                  onChange={(e) => setExpiry(e.target.value || undefined)}
                  className="w-full rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-white outline-none"
                >
                  <option value="">Nearest expiry</option>
                  {expiries.map((item: any) => (
                    <option key={item.expiry} value={item.expiry}>{item.date || item.expiry}</option>
                  ))}
                </select>
              </label>
              <label className="col-span-2">
                <span className="text-[10px] text-slate-500 block mb-1">Max Loss Cap</span>
                <input type="number" value={maxLossCap} onChange={(e) => setMaxLossCap(Number(e.target.value) || 0)} className="w-full rounded border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-white outline-none" />
              </label>
            </div>
            <div className={`mt-3 rounded-lg border px-3 py-2 text-[11px] ${unresolvedLegs.length ? "border-amber-500/20 bg-amber-500/10 text-amber-200" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"}`}>
              {chain.isLoading
                ? "Loading option symbols for selected expiry..."
                : unresolvedLegs.length
                  ? `Cannot resolve ${unresolvedLegs.length} leg(s). Check strike, type, underlying, or expiry.`
                  : "All legs resolved to live Fyers option symbols."}
            </div>
            <button onClick={() => loadPreset()} className="mt-3 w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-500">Reload Preset Legs</button>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-bold text-slate-300">Legs ({legs.length})</div>
              <button onClick={addLeg} className="text-xs font-bold text-indigo-400 hover:text-indigo-300"><Plus className="inline h-3.5 w-3.5" /> Add</button>
            </div>
            <div className="mb-1 grid grid-cols-12 gap-1 text-[9px] uppercase tracking-wider text-slate-500">
              <span className="col-span-3">Side</span>
              <span className="col-span-2">Lots</span>
              <span className="col-span-2">Type</span>
              <span className="col-span-2">Strike</span>
              <span className="col-span-2">Premium</span>
            </div>
            <div className="space-y-2.5">
              {legs.map((leg, index) => {
                const lots = Math.max(1, Math.round(leg.qty / lotSize));
                return (
                  <div key={`${leg.symbol}-${index}`} className="grid grid-cols-12 gap-1 text-xs items-center">
                    <select value={leg.side} onChange={(e) => updateLeg(index, { side: e.target.value as StrategyLeg["side"] })} className={`col-span-3 rounded px-1.5 py-1 font-bold ${leg.side === "BUY" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>
                      <option>BUY</option><option>SELL</option>
                    </select>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={lots}
                      onChange={(e) => updateLeg(index, { qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) * lotSize })}
                      className="col-span-2 rounded border border-slate-800 bg-slate-950 px-1 py-1 font-mono text-center text-white"
                      title={`Lots. 1 lot = ${lotSize} qty`}
                    />
                    <select value={leg.type} onChange={(e) => updateLeg(index, { type: e.target.value as StrategyLeg["type"] })} className="col-span-2 rounded border border-slate-800 bg-slate-950 px-1 py-1 font-bold text-white">
                      <option>CE</option><option>PE</option>
                    </select>
                    <input
                      type="number"
                      step={strikeStep}
                      value={leg.strike}
                      onChange={(e) => updateLeg(index, { strike: Number(e.target.value) || 0 })}
                      className="col-span-2 rounded border border-slate-800 bg-slate-950 px-1 py-1 font-mono text-white"
                      title="Strike"
                    />
                    <input
                      type="number"
                      min={0.05}
                      step={0.05}
                      value={leg.premium}
                      onChange={(e) => updateLeg(index, { premium: Number(e.target.value) || 0 })}
                      className="col-span-2 rounded border border-slate-800 bg-slate-950 px-1 py-1 font-mono text-white"
                      title="Premium"
                    />
                    <button onClick={() => removeLeg(index)} className="col-span-1 text-center text-slate-600 hover:text-rose-400"><Trash2 className="inline h-3.5 w-3.5" /></button>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 text-[10px] text-slate-500">1 lot = {lotSize} qty. Premium is the option price used for payoff and paper entry.</div>
            <div className="mt-3 space-y-1 border-t border-slate-800 pt-3 text-[10px] text-slate-500">
              {resolvedLegs.map((leg, index) => (
                <div key={`${leg.symbol}-resolved-${index}`} className="flex items-center justify-between gap-2">
                  <span>{leg.symbol}</span>
                  <span className={leg.resolvedSymbol ? "font-mono text-emerald-300" : "text-amber-300"}>
                    {leg.resolvedSymbol || "Not resolved"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 min-w-0 rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <div className="rounded-lg bg-slate-950 p-3 border border-slate-800/60">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Range Max Profit</div>
              <div className={`text-lg font-black font-mono tracking-tight ${signColor(maxProfit)}`}>{inr(maxProfit)}</div>
            </div>
            <div className="rounded-lg bg-slate-950 p-3 border border-slate-800/60">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Max Loss</div>
              <div className={`text-lg font-black font-mono tracking-tight ${signColor(maxLoss)}`}>{inr(maxLoss)}</div>
            </div>
            <div className="rounded-lg bg-slate-950 p-3 border border-slate-800/60">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Breakeven</div>
              <div className="text-xs font-bold font-mono text-slate-200 mt-1">{breakeven.length ? breakeven.join(" / ") : "--"}</div>
            </div>
            <div className="rounded-lg bg-slate-950 p-3 border border-slate-800/60">
              <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Risk Check</div>
              <div className={`text-xs font-black mt-1 ${canPaperPlace ? "text-emerald-300" : "text-rose-300"}`}>
                {definedRisk ? (withinRisk ? "Within cap" : "Above max loss") : "Uncovered short"}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
            <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-emerald-400" />
            Paper placement is allowed only when the payoff is defined-risk and max loss is within your cap.
          </div>

          <div style={{ width: "100%", height: 420, minHeight: 420, minWidth: 0 }}>
            <ResponsiveContainer width="99%" height={420}>
              <LineChart data={chartData}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="spot" stroke="#475569" fontSize={10} />
                <YAxis stroke="#475569" fontSize={10} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", fontSize: 12 }} />
                <ReferenceLine y={0} stroke="#475569" />
                <ReferenceLine x={spot} stroke="#6366f1" strokeDasharray="3 3" label={{ value: "Spot", fill: "#6366f1", fontSize: 10 }} />
                <Line type="monotone" dataKey="pnl" stroke="#6366f1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <button
            onClick={() => paperPlace.mutate()}
            disabled={!canPaperPlace || paperPlace.isPending}
            className="w-full rounded-lg bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
          >
            {paperPlace.isPending ? "Placing Paper Strategy..." : `Paper Buy Strategy - Max Loss ${inr(riskAmount)}`}
          </button>
          {paperMessage && <div className="text-center text-xs text-slate-400">{paperMessage}</div>}
        </div>
      </div>
    </div>
  );
}
