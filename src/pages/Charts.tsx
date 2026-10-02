import { cloneElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  Area, Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { BarChart2, BookmarkPlus, Search } from "lucide-react";
import { useWatchlist } from "../stores";
import { api } from "../lib/api";
import { evaluateCandlestickPattern } from "../lib/candlestickPatterns";
import { evaluateMarketRegime, MARKET_REGIME_DISPLAY } from "../lib/marketRegime";
import { inr, pct } from "../lib/utils";
import { CandlestickShape } from "./charts/CandlestickShape";
import { ChartTooltip } from "./charts/ChartTooltip";
import {
  SYMBOLS, TIMEFRAMES, calculateChartStudies, calculatePriceLevels, dateKey,
  finiteNumber, mergeLiveTick, normalizeCandle, selectChartPoints, sessionLabel,
  yDomain, type ChartPoint, type LiveTick, type RawCandle,
} from "./charts/chartData";

const CHART_SYMBOLS_KEY = "fyers_v3_chart_symbols";
const RESOLUTIONS: Record<string, { value: string; days: number; seconds: number }> = {
  "1m": { value: "1", days: 7, seconds: 60 },
  "5m": { value: "5", days: 7, seconds: 300 },
  "15m": { value: "15", days: 7, seconds: 900 },
  "1h": { value: "60", days: 30, seconds: 3600 },
  "1d": { value: "D", days: 60, seconds: 86400 },
};

type OverlayKey = "vwap" | "ema20" | "ema50" | "previous" | "session" | "levels" | "rsi";

function readChartSymbols() {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(CHART_SYMBOLS_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((value): value is string => typeof value === "string" && value.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function normalizeChartSymbol(input: string) {
  const raw = input.trim().toUpperCase();
  if (!raw) return "";
  if (raw === "NIFTY" || raw === "NIFTY50") return "NSE:NIFTY50-INDEX";
  if (raw === "BANKNIFTY" || raw === "NIFTYBANK") return "NSE:NIFTYBANK-INDEX";
  if (raw === "FINNIFTY") return "NSE:FINNIFTY-INDEX";
  if (raw === "MIDCPNIFTY") return "NSE:MIDCPNIFTY-INDEX";
  if (raw.includes(":")) return raw;
  if (raw.endsWith("-EQ") || raw.endsWith("-INDEX")) return `NSE:${raw}`;
  return `NSE:${raw}-EQ`;
}

function SummaryItem({ label, value, detail, tone = "text-white" }: { label: string; value: string; detail?: string; tone?: string }) {
  return (
    <div className="min-w-0 border-l border-slate-800 pl-3 first:border-l-0 first:pl-0">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-0.5 truncate text-xs font-bold ${tone}`}>{value}</div>
      {detail && <div className="mt-0.5 truncate text-[10px] text-slate-500" title={detail}>{detail}</div>}
    </div>
  );
}

function MeasuredChartContainer({
  children,
  className,
  containerKey,
}: {
  children: ReactElement<{ height?: number; width?: number }>;
  className: string;
  containerKey?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const update = (rect: DOMRectReadOnly) => {
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      setSize(width > 0 && height > 0 ? { width, height } : null);
    };
    update(node.getBoundingClientRect());
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) update(rect);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {size && cloneElement(children, { key: containerKey, width: size.width, height: size.height })}
    </div>
  );
}

export default function Charts() {
  const [symbol, setSymbol] = useState("NSE:NIFTY50-INDEX");
  const [symbolSearch, setSymbolSearch] = useState("");
  const [customSymbols, setCustomSymbols] = useState<string[]>(readChartSymbols);
  const [timeframe, setTimeframe] = useState("5m");
  const [chartMode, setChartMode] = useState<"candles" | "line">("candles");
  const [liveTick, setLiveTick] = useState<LiveTick | null>(null);
  const [overlays, setOverlays] = useState<Record<OverlayKey, boolean>>({
    vwap: true, ema20: true, ema50: false, previous: true, session: true, levels: false, rsi: true,
  });
  const previousCumulativeVolume = useRef<number | null>(null);
  const watchlistSymbols = useWatchlist((state) => state.symbols);
  const resolution = RESOLUTIONS[timeframe] ?? RESOLUTIONS["5m"];
  const isDaily = timeframe === "1d";

  const chartSymbols = useMemo(
    () => Array.from(new Set([...SYMBOLS, ...watchlistSymbols, ...customSymbols])).sort((a, b) => a.localeCompare(b)),
    [customSymbols, watchlistSymbols],
  );

  const historyQuery = useQuery({
    queryKey: ["history", symbol, resolution.value, resolution.days],
    queryFn: () => api.history(symbol, resolution.value, resolution.days),
    staleTime: Math.min(resolution.seconds * 500, 60_000),
  });

  useEffect(() => {
    setLiveTick(null);
    previousCumulativeVolume.current = null;
  }, [symbol, timeframe]);

  useEffect(() => {
    function handleTick(event: Event) {
      const detail = (event as CustomEvent).detail || {};
      const ticks = detail.type === "tick" && detail.payload ? [detail.payload] : Object.values(detail);
      const tick = ticks.find((value: any) => value?.symbol === symbol && finiteNumber(value?.ltp) !== null) as any;
      if (!tick) return;
      const cumulativeVolume = finiteNumber(tick.volume);
      const volumeDelta = cumulativeVolume !== null && previousCumulativeVolume.current !== null
        ? Math.max(0, cumulativeVolume - previousCumulativeVolume.current)
        : 0;
      if (cumulativeVolume !== null) previousCumulativeVolume.current = cumulativeVolume;
      setLiveTick({ ts: Math.floor(Date.now() / 1000), price: Number(tick.ltp), volume: volumeDelta });
    }
    window.addEventListener("fyers_ticks", handleTick);
    return () => window.removeEventListener("fyers_ticks", handleTick);
  }, [symbol]);

  const chart = useMemo(() => {
    const response = (historyQuery.data ?? {}) as { candles?: RawCandle[]; data?: { candles?: RawCandle[] } };
    const candles = Array.isArray(response.candles) ? response.candles : Array.isArray(response.data?.candles) ? response.data.candles : [];
    const all = candles.map((candle) => normalizeCandle(candle, isDaily)).filter((point): point is ChartPoint => Boolean(point));
    const selected = selectChartPoints([...all], isDaily);
    const merged = mergeLiveTick(selected, liveTick, isDaily, resolution.seconds);
    const studies = calculateChartStudies(merged);
    const levels = calculatePriceLevels(all, merged);
    const first = studies[0];
    const last = studies[studies.length - 1];
    return {
      all,
      points: studies,
      levels,
      sessionText: first ? sessionLabel(first.date) : "No verified session",
      isFallbackSession: !isDaily && Boolean(last) && last.date !== dateKey(new Date()),
      yDomain: yDomain(studies),
    };
  }, [historyQuery.data, isDaily, liveTick, resolution.seconds]);

  const data = chart.points;
  const completedData = data.filter((point) => !point.live);
  const candleSignal = useMemo(() => evaluateCandlestickPattern(completedData), [completedData]);
  const formingSignal = useMemo(() => data.some((point) => point.live) ? evaluateCandlestickPattern(data) : null, [data]);
  const marketRegime = useMemo(() => evaluateMarketRegime(completedData), [completedData]);
  const regimeDisplay = MARKET_REGIME_DISPLAY[marketRegime.regime];
  const currentPrice = data.length ? data[data.length - 1].close : null;
  const startPrice = data.length ? data[0].open : null;
  const changePct = currentPrice !== null && startPrice && startPrice > 0 ? ((currentPrice - startPrice) / startPrice) * 100 : null;
  const sessionHigh = data.length ? Math.max(...data.map((point) => point.high)) : null;
  const sessionLow = data.length ? Math.min(...data.map((point) => point.low)) : null;
  const latestTimestamp = data[data.length - 1]?.ts ?? null;
  const staleSeconds = latestTimestamp ? Math.max(0, Math.floor(Date.now() / 1000) - latestTimestamp) : null;
  const staleLimit = Math.max(120, resolution.seconds * 2);
  const isStale = staleSeconds === null || staleSeconds > staleLimit;
  const verified = data.length >= 2 && currentPrice !== null && currentPrice > 0 && !historyQuery.isError;
  const trend = changePct === null ? "--" : changePct > 0.2 ? "Bullish" : changePct < -0.2 ? "Bearish" : "Sideways";

  function loadSymbol(raw = symbolSearch) {
    const next = normalizeChartSymbol(raw);
    if (!next) return;
    setSymbol(next);
    setSymbolSearch("");
  }

  function saveCurrentSymbol() {
    if (!verified || customSymbols.includes(symbol) || SYMBOLS.includes(symbol) || watchlistSymbols.includes(symbol)) return;
    setCustomSymbols((current) => {
      const updated = [...current, symbol].sort((a, b) => a.localeCompare(b));
      localStorage.setItem(CHART_SYMBOLS_KEY, JSON.stringify(updated));
      return updated;
    });
  }

  function toggleOverlay(key: OverlayKey) {
    setOverlays((current) => ({ ...current, [key]: !current[key] }));
  }

  const freshness = !verified ? "No verified data" : isStale ? `Stale · ${staleSeconds}s` : liveTick ? "Live" : `Fresh · ${staleSeconds}s`;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3 p-5 animate-in fade-in duration-200">
      <div className="flex flex-wrap items-center gap-2">
        <form className="flex items-center gap-1" onSubmit={(event) => { event.preventDefault(); loadSymbol(); }}>
          <label htmlFor="chart-symbol-search" className="sr-only">Chart symbol</label>
          <input id="chart-symbol-search" name="chartSymbolSearch" list="chart-symbols" value={symbolSearch} onChange={(event) => setSymbolSearch(event.target.value)} placeholder={symbol} className="w-56 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-bold text-white outline-none focus:border-indigo-500" />
          <datalist id="chart-symbols">{chartSymbols.map((value) => <option key={value} value={value} />)}</datalist>
          <button type="submit" title="Load symbol" className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-300 hover:border-indigo-500"><Search className="h-3.5 w-3.5" /></button>
          <button type="button" title={verified ? "Save verified symbol" : "Load valid data before saving"} onClick={saveCurrentSymbol} disabled={!verified} className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-300 hover:border-indigo-500 disabled:opacity-35"><BookmarkPlus className="h-3.5 w-3.5" /></button>
        </form>

        <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-xs">
          {TIMEFRAMES.map((value) => <button key={value} onClick={() => setTimeframe(value)} className={`rounded px-2.5 py-1 font-bold ${timeframe === value ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}>{value}</button>)}
        </div>
        <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-xs">
          {(["candles", "line"] as const).map((value) => <button key={value} onClick={() => setChartMode(value)} className={`rounded px-2.5 py-1 capitalize ${chartMode === value ? "bg-slate-700 text-white" : "text-slate-500"}`}>{value}</button>)}
        </div>
        <span className={`rounded border px-2 py-1 text-[10px] font-semibold ${!verified || isStale ? "border-amber-500/20 bg-amber-500/10 text-amber-300" : "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"}`}>{freshness}</span>
        <div className="ml-auto rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-200">Analysis only</div>
      </div>

      <div className="grid grid-cols-2 gap-y-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryItem label="Visible trend" value={trend} detail={changePct === null ? "No data" : pct(changePct)} tone={changePct === null ? "text-slate-500" : changePct >= 0 ? "text-emerald-300" : "text-rose-300"} />
        <SummaryItem label="Regime" value={verified ? regimeDisplay.label : "--"} detail={verified ? regimeDisplay.action : "No verified candles"} />
        <SummaryItem label="Session range" value={sessionLow !== null && sessionHigh !== null ? `${sessionLow.toFixed(2)} – ${sessionHigh.toFixed(2)}` : "--"} />
        <SummaryItem label="Confirmed pattern" value={verified ? candleSignal.name : "--"} detail={candleSignal.direction !== "neutral" ? `${candleSignal.score}/100 · completed candle` : "Completed candles only"} />
        <SummaryItem label="Forming pattern" value={formingSignal?.name ?? "None"} detail={formingSignal ? "Provisional until candle close" : "No live forming signal"} tone="text-amber-300" />
        <SummaryItem label="LTP" value={currentPrice !== null ? inr(currentPrice) : "--"} detail={chart.sessionText} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="mr-1 uppercase tracking-wider text-slate-600">Studies</span>
        {([
          ["vwap", "VWAP"], ["ema20", "EMA20"], ["ema50", "EMA50"], ["previous", "Prev H/L"],
          ["session", "Session H/L"], ["levels", "Support/Resistance"], ["rsi", "RSI"],
        ] as [OverlayKey, string][]).map(([key, label]) => (
          <button key={key} onClick={() => toggleOverlay(key)} className={`rounded border px-2 py-1 ${overlays[key] ? "border-indigo-500/30 bg-indigo-500/15 text-indigo-200" : "border-slate-800 bg-slate-900 text-slate-500"}`}>{label}</button>
        ))}
      </div>

      <div className="relative flex min-h-[500px] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900/20 p-3">
        <div className="mb-1 flex items-center gap-2 font-mono text-[10px] text-slate-500"><BarChart2 className="h-3.5 w-3.5 text-indigo-400" />Fyers v3 · verified OHLC and volume {chart.isFallbackSession ? "· latest available session" : ""}</div>
        {(historyQuery.isLoading || historyQuery.isError || !verified) && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-slate-950/35 px-4 text-center text-xs text-slate-400">
            {historyQuery.isLoading ? "Loading verified candles..." : historyQuery.isError ? historyQuery.error instanceof Error ? historyQuery.error.message : "Failed to fetch chart data" : "No verified candle data available for this selection"}
          </div>
        )}

        <MeasuredChartContainer className="h-[clamp(360px,55vh,620px)] min-w-0 w-full shrink-0" containerKey={`${symbol}-${timeframe}-${chartMode}`}>
          <ComposedChart data={data} margin={{ top: 12, right: 20, bottom: 4, left: 0 }}>
            <defs><linearGradient id="chartPrice" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.24} /><stop offset="95%" stopColor="#6366f1" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
            <XAxis dataKey="time" stroke="#475569" fontSize={10} interval="preserveStartEnd" minTickGap={40} />
            <YAxis yAxisId="price" stroke="#475569" fontSize={10} domain={chart.yDomain} width={64} />
            <YAxis yAxisId="volume" orientation="right" hide domain={[0, "dataMax"]} />
            <Tooltip content={<ChartTooltip />} />
            <Bar yAxisId="volume" dataKey="volume" barSize={6} opacity={0.32}>{data.map((point) => <Cell key={`v-${point.ts}`} fill={point.close >= point.open ? "#10b981" : "#f43f5e"} />)}</Bar>
            {chartMode === "candles" ? <Bar yAxisId="price" dataKey="candleRange" shape={<CandlestickShape />} isAnimationActive={false} /> : <Area yAxisId="price" type="monotone" dataKey="close" stroke="#6366f1" fill="url(#chartPrice)" strokeWidth={2} dot={false} />}
            {overlays.vwap && <Line yAxisId="price" type="monotone" dataKey="vwap" stroke="#22d3ee" strokeWidth={1.2} dot={false} connectNulls />}
            {overlays.ema20 && <Line yAxisId="price" type="monotone" dataKey="ema20" stroke="#f59e0b" strokeWidth={1.1} dot={false} connectNulls />}
            {overlays.ema50 && <Line yAxisId="price" type="monotone" dataKey="ema50" stroke="#a78bfa" strokeWidth={1.1} dot={false} connectNulls />}
            {overlays.previous && chart.levels.previousHigh !== null && <ReferenceLine yAxisId="price" y={chart.levels.previousHigh} stroke="#38bdf8" strokeDasharray="5 4" label={{ value: "PDH", fill: "#38bdf8", fontSize: 9 }} />}
            {overlays.previous && chart.levels.previousLow !== null && <ReferenceLine yAxisId="price" y={chart.levels.previousLow} stroke="#38bdf8" strokeDasharray="5 4" label={{ value: "PDL", fill: "#38bdf8", fontSize: 9 }} />}
            {overlays.session && sessionHigh !== null && <ReferenceLine yAxisId="price" y={sessionHigh} stroke="#10b981" strokeOpacity={0.55} label={{ value: "H", fill: "#10b981", fontSize: 9 }} />}
            {overlays.session && sessionLow !== null && <ReferenceLine yAxisId="price" y={sessionLow} stroke="#f43f5e" strokeOpacity={0.55} label={{ value: "L", fill: "#f43f5e", fontSize: 9 }} />}
            {overlays.levels && chart.levels.support !== null && <ReferenceLine yAxisId="price" y={chart.levels.support} stroke="#34d399" strokeDasharray="2 3" label={{ value: "S", fill: "#34d399", fontSize: 9 }} />}
            {overlays.levels && chart.levels.resistance !== null && <ReferenceLine yAxisId="price" y={chart.levels.resistance} stroke="#fb7185" strokeDasharray="2 3" label={{ value: "R", fill: "#fb7185", fontSize: 9 }} />}
            {currentPrice !== null && <ReferenceLine yAxisId="price" y={currentPrice} stroke="#818cf8" strokeDasharray="3 3" />}
          </ComposedChart>
        </MeasuredChartContainer>

        {overlays.rsi && (
          <MeasuredChartContainer className="h-28 min-w-0 w-full shrink-0 border-t border-slate-800 pt-1">
            <ComposedChart data={data} margin={{ top: 2, right: 20, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#172033" strokeDasharray="3 3" />
              <XAxis dataKey="time" hide />
              <YAxis domain={[0, 100]} ticks={[30, 50, 70]} width={32} stroke="#475569" fontSize={9} />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine y={70} stroke="#f43f5e" strokeDasharray="3 3" />
              <ReferenceLine y={30} stroke="#10b981" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="rsi" stroke="#a78bfa" strokeWidth={1.4} dot={false} connectNulls />
            </ComposedChart>
          </MeasuredChartContainer>
        )}
      </div>
    </div>
  );
}
