import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Bitcoin, RefreshCw } from "lucide-react";
import { AnalysisPanel } from "../components/AnalysisPanel";
import { api, type CryptoMarketSnapshot } from "../lib/api";
import { CandlestickShape } from "./charts/CandlestickShape";
import { calculateChartStudies, normalizeCandle, yDomain } from "./charts/chartData";

const ASSETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"];
const TIMEFRAMES = [{ label: "15m", value: "15m" }, { label: "1h", value: "1h" }, { label: "4h", value: "4h" }, { label: "1d", value: "1d" }];

export default function Crypto() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState("1h");
  const [horizon, setHorizon] = useState("Swing");
  const market = useQuery({ queryKey: ["crypto-market", symbol, interval], queryFn: () => api.getCryptoMarket(symbol, interval), staleTime: 30_000, refetchInterval: 60_000 });
  const data = market.data as CryptoMarketSnapshot | undefined;
  const chart = useMemo(() => calculateChartStudies((data?.candles || []).map((row) => normalizeCandle(row, interval === "1d")).filter(Boolean) as any), [data?.candles, interval]);
  const quote = data?.market;

  return <div className="space-y-5 p-5 animate-in fade-in duration-200">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-black text-white"><Bitcoin className="h-6 w-6 text-amber-300" />Crypto</h1><p className="mt-1 text-sm text-slate-400">Public market data and analysis only. No wallet, keys, deposits, withdrawals, or exchange orders.</p></div><span className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-200">VIEW ONLY</span></div>
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4"><label className="text-xs text-slate-400">Asset<select value={symbol} onChange={(e) => setSymbol(e.target.value)} className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white">{ASSETS.map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-xs text-slate-400">Candle<select value={interval} onChange={(e) => setInterval(e.target.value)} className="mt-1 block rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white">{TIMEFRAMES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><button onClick={() => market.refetch()} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-slate-200"><RefreshCw className={`h-3.5 w-3.5 ${market.isFetching ? "animate-spin" : ""}`} />Refresh market</button><span className="ml-auto text-xs text-slate-500">Provider: Binance public market-data API · Quote: USDT</span></div>
    {market.isError && <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200">{market.error instanceof Error ? market.error.message : "Crypto provider unavailable."}</div>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"><Card label="Last" value={money(quote?.last_price)} /><Card label="24h Change" value={quote?.change_percent_24h == null ? "Unavailable" : `${quote.change_percent_24h.toFixed(2)}%`} /><Card label="24h High" value={money(quote?.high_24h)} /><Card label="24h Low" value={money(quote?.low_24h)} /><Card label="24h Volume" value={number(quote?.base_volume_24h)} /><Card label="Market Cap" value="Unavailable" /></div>
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4"><div className="mb-3 flex items-center justify-between"><div className="text-sm font-bold text-white">OHLC Candles</div><span className={`rounded px-2 py-1 text-[10px] font-bold ${data?.data_freshness === "REAL TIME" ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"}`}>{data?.data_freshness || "LOADING"} {data?.data_timestamp ? `· ${new Date(data.data_timestamp).toLocaleString("en-IN")}` : ""}</span></div><div className="h-[380px] min-w-0">{chart.length > 0 ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={chart} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}><CartesianGrid stroke="#1e293b" strokeDasharray="3 3" /><XAxis dataKey="time" stroke="#64748b" fontSize={10} minTickGap={40} /><YAxis domain={yDomain(chart)} stroke="#64748b" fontSize={10} width={76} /><Tooltip /><Bar dataKey="candleRange" shape={<CandlestickShape />} isAnimationActive={false} /></ComposedChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-sm text-slate-500">{market.isLoading ? "Loading public candles…" : "No verified candles available."}</div>}</div></div>
    <AnalysisPanel assetType="crypto" symbol={symbol} resolution={interval} horizons={["Short-term", "Swing", "Medium-term"]} horizon={horizon} onHorizonChange={setHorizon} />
  </div>;
}

function Card({ label, value }: { label: string; value: string }) { return <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-3"><div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div><div className="mt-1 font-mono text-sm font-bold text-white">{value}</div></div>; }
function money(value?: number | null) { return value == null ? "Unavailable" : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: value < 10 ? 4 : 2 }).format(value)} USDT`; }
function number(value?: number | null) { return value == null ? "Unavailable" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value); }
