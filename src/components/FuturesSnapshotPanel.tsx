import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw } from "lucide-react";
import { api } from "../lib/api";

function number(value: number | null | undefined, digits = 2) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-IN", { maximumFractionDigits: digits })
    : "--";
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div><div className="mt-1 text-sm font-bold text-slate-100">{value}</div></div>;
}

export function FuturesSnapshotPanel({ symbol }: { symbol: string }) {
  const [contractSymbol, setContractSymbol] = useState("");
  useEffect(() => setContractSymbol(""), [symbol]);
  const snapshot = useQuery({
    queryKey: ["futures-market", symbol, contractSymbol],
    queryFn: () => api.getFuturesMarket(symbol, contractSymbol || undefined),
    enabled: Boolean(symbol),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  const data = snapshot.data;
  const market = data?.market;
  const activeContract = contractSymbol || data?.instrument.contract_symbol || "";

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950/55 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-white"><Activity className="h-4 w-4 text-cyan-300" />Futures Confirmation</div>
          <p className="mt-1 text-xs text-slate-500">Active NSE futures discovered from the FYERS symbol master; quotes and history come from FYERS v3.</p>
        </div>
        <div className="flex items-center gap-2">
          {data?.contracts.length ? <select value={activeContract} onChange={(event) => setContractSymbol(event.target.value)} className="max-w-64 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-white">{data.contracts.map((contract) => <option key={contract.contract_symbol} value={contract.contract_symbol}>{contract.expiry} · {contract.contract_symbol}</option>)}</select> : null}
          <button type="button" onClick={() => snapshot.refetch()} disabled={snapshot.isFetching} title="Refresh futures data" className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:border-cyan-500 disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${snapshot.isFetching ? "animate-spin" : ""}`} /></button>
        </div>
      </div>

      {snapshot.isLoading && <div className="mt-4 text-xs text-slate-500">Loading current futures contract and market data…</div>}
      {snapshot.isError && <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">{snapshot.error instanceof Error ? snapshot.error.message : "Futures data is unavailable."}</div>}
      {data && market && <>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
          <Metric label="Contract" value={data.instrument.contract_symbol} />
          <Metric label="Expiry" value={`${data.instrument.expiry} · ${market.days_to_expiry}d`} />
          <Metric label="Lot size" value={number(data.instrument.lot_size, 0)} />
          <Metric label="Future" value={number(market.futures_price)} />
          <Metric label="Spot" value={number(market.spot_price)} />
          <Metric label="Basis" value={`${number(market.basis)} (${number(market.basis_percent)}%)`} />
          <Metric label="Open interest" value={number(market.open_interest, 0)} />
          <Metric label="OI change" value={number(market.change_in_open_interest, 0)} />
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-800 pt-3 text-[10px] text-slate-500">
          <span>{data.data_freshness}</span>
          <span>{new Date(data.data_timestamp).toLocaleString("en-IN")}</span>
          <span>{market.premium_discount}</span>
          <span>Sources: {data.data_sources.join(", ")}</span>
        </div>
        <p className="mt-2 text-[10px] text-amber-300/80">{data.interpretation_limits.join(" ")}</p>
      </>}
    </section>
  );
}