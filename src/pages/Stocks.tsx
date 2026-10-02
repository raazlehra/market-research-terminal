import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, SlidersHorizontal, Trash2 } from "lucide-react";
import { useScanner } from "../hooks";
import { SCANNERS } from "../lib/scanners";
import { inr, pct } from "../lib/utils";
import { useWatchlist } from "../stores";
import { AnalysisPanel } from "../components/AnalysisPanel";

import { DEFAULT_STRATEGY, FACTORS, TIMEFRAMES, confidenceTone, numberValue, readSavedSnapshot, storageKey, volumeLabel, type ScannerResponse, type ScannerResult, type SideFilter, type SortKey } from "./stocks/helpers";
export default function Stocks() {
  const addWatchlist = useWatchlist((s) => s.add);
  const [researchSymbol, setResearchSymbol] = useState("NSE:RELIANCE-EQ");
  const [analysisHorizon, setAnalysisHorizon] = useState("Swing");

  const [universe, setUniverse] = useState(() => localStorage.getItem("stocks_universe") || "FNO");
  const [strategy, setStrategy] = useState(() => {
    const saved = localStorage.getItem("stocks_strategy");
    return SCANNERS.some((s) => s.v === saved) ? saved as string : DEFAULT_STRATEGY;
  });
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem("stocks_timeframe") || "15");
  const [scanId, setScanId] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>(() => (localStorage.getItem("stocks_sort") as SortKey) || "confidence");
  const [sideFilter, setSideFilter] = useState<SideFilter>(() => (localStorage.getItem("stocks_side") as SideFilter) || "ALL");
  const [minConfidence, setMinConfidence] = useState(() => numberValue(localStorage.getItem("stocks_min_confidence"), 50));

  const currentStorageKey = useMemo(() => storageKey(universe, strategy, timeframe), [universe, strategy, timeframe]);
  const initialSaved = readSavedSnapshot(currentStorageKey);
  const [savedResults, setSavedResults] = useState<ScannerResult[]>(initialSaved.results);
  const [savedAt, setSavedAt] = useState<string | null>(initialSaved.savedAt);

  const scanParams = useMemo(() => ({
    universe,
    resolution: timeframe,
    scanId,
  }), [universe, timeframe, scanId]);

  useEffect(() => {
    if (!SCANNERS.some((s) => s.v === strategy)) {
      setStrategy(DEFAULT_STRATEGY);
    }
  }, [strategy]);

  const scan = useScanner(strategy, scanParams, scanId > 0);
  const scanData = scan.data as ScannerResponse | undefined;
  const hasFreshScan = Boolean(scanData && !scanData.busy && Array.isArray(scanData.results));
  const liveResults = Array.isArray(scanData?.results) ? scanData.results : [];
  const activeResults = hasFreshScan ? liveResults : savedResults;
  const usingSavedResults = savedResults.length > 0 && !hasFreshScan && !scan.isLoading;
  const selectedScanner = SCANNERS.find((s) => s.v === strategy);

  const visibleResults = useMemo(() => {
    return [...activeResults]
      .filter((stock) => sideFilter === "ALL" || stock.side === sideFilter)
      .filter((stock) => numberValue(stock.confidence) >= minConfidence)
      .sort((a, b) => {
        if (sortKey === "symbol") return a.symbol.localeCompare(b.symbol);
        if (sortKey === "change") return Math.abs(numberValue(b.chp)) - Math.abs(numberValue(a.chp));
        if (sortKey === "volume") return numberValue(b.volume) - numberValue(a.volume);
        return numberValue(b.confidence) - numberValue(a.confidence);
      });
  }, [activeResults, minConfidence, sideFilter, sortKey]);

  useEffect(() => {
    localStorage.setItem("stocks_universe", universe);
    localStorage.setItem("stocks_strategy", strategy);
    localStorage.setItem("stocks_timeframe", timeframe);
    localStorage.setItem("stocks_sort", sortKey);
    localStorage.setItem("stocks_side", sideFilter);
    localStorage.setItem("stocks_min_confidence", String(minConfidence));
  }, [universe, strategy, timeframe, sortKey, sideFilter, minConfidence]);

  useEffect(() => {
    const saved = readSavedSnapshot(currentStorageKey);
    setSavedResults(saved.results);
    setSavedAt(saved.savedAt);
  }, [currentStorageKey]);

  useEffect(() => {
    if (!scanData || scanData.busy || !Array.isArray(scanData.results)) return;
    try {
      const savedAtValue = new Date().toISOString();
      localStorage.setItem(
        currentStorageKey,
        JSON.stringify({
          savedAt: savedAtValue,
          params: scanParams,
          results: scanData.results,
        })
      );
      setSavedResults(scanData.results);
      setSavedAt(savedAtValue);
    } catch {
      // Storage can fail in private windows or low-disk states.
    }
  }, [currentStorageKey, scanData, scanParams]);

  function runScan() {
    setScanId((id) => id + 1);
  }

  function clearSavedResults() {
    localStorage.removeItem(currentStorageKey);
    setSavedResults([]);
    setSavedAt(null);
  }

  return (
    <div className="p-5 space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight">Stocks Selection</h1>
          <p className="mt-1 text-sm text-slate-400">
            Scan verified equity data and inspect analysis-only signals with an explicit horizon.
          </p>
        </div>
        <button
          onClick={runScan}
          disabled={scan.isLoading}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${scan.isLoading ? "animate-spin" : ""}`} />
          {scan.isLoading ? "Scanning" : "Run Scan"}
        </button>
      </div>

      <div className="rounded-2xl border border-emerald-500/20 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 text-xs text-slate-400">Selected stock for research
            <input value={researchSymbol} onChange={(event) => setResearchSymbol(event.target.value.toUpperCase())} placeholder="NSE:RELIANCE-EQ" className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" />
          </label>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-3 py-2 text-xs font-bold text-emerald-200">VIEW ONLY · analysis signals are not orders</div>
        </div>
      </div>

      <AnalysisPanel
        assetType="equity"
        symbol={researchSymbol}
        resolution="D"
        horizons={["Intraday", "Swing", "Positional"]}
        horizon={analysisHorizon}
        onHorizonChange={setAnalysisHorizon}
      />


      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <label className="space-y-1 text-xs text-slate-400">
            <span>Universe</span>
            <select
              value={universe}
              onChange={(e) => setUniverse(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none"
            >
              <option value="FNO">FnO</option>
              <option value="NIFTY50">Nifty 50</option>
            </select>
          </label>

          <label className="space-y-1 text-xs text-slate-400">
            <span>Timeframe</span>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none"
            >
              {TIMEFRAMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>

          <label className="space-y-1 text-xs text-slate-400 xl:col-span-2">
            <span>Strategy</span>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none"
            >
              {SCANNERS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
          </label>

          <label className="space-y-1 text-xs text-slate-400">
            <span>Side</span>
            <select
              value={sideFilter}
              onChange={(e) => setSideFilter(e.target.value as SideFilter)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none"
            >
              <option value="ALL">All</option>
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
            </select>
          </label>

          <label className="space-y-1 text-xs text-slate-400">
            <span>Sort</span>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none"
            >
              <option value="confidence">Rule Score</option>
              <option value="change">Change %</option>
              <option value="volume">Volume</option>
              <option value="symbol">Symbol</option>
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <SlidersHorizontal className="h-4 w-4 text-indigo-400" />
            <span>Min rule score</span>
            <input
              type="range"
              min={0}
              max={95}
              step={5}
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
              className="w-36"
            />
            <span className="font-mono text-slate-200">{minConfidence}/100</span>
          </div>
          <button
            onClick={clearSavedResults}
            disabled={!savedResults.length}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear Saved
          </button>
        </div>

        <p className="mt-3 text-xs text-slate-500">{selectedScanner?.desc || "Scanner strategy"}</p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white">{selectedScanner?.label || strategy.replace(/_/g, " ")}</h2>
            <div className="mt-1 text-xs text-slate-500">
              {universe} / {TIMEFRAMES.find((t) => t.value === timeframe)?.label} / scan #{scanId || "-"}
              {scanData?.elapsed != null && (
                <span className="ml-2 text-slate-400">
                  {numberValue(scanData.elapsed).toFixed(1)}s · quotes {scanData.scanned ?? 0} · candidates {scanData.prefiltered ?? scanData.history_requested ?? 0} · history {scanData.history_ok ?? 0}/{scanData.history_requested ?? 0}
                  {scanData.cached ? ` · cached (${scanData.cooldown_remaining ?? 0}s cooldown)` : ""}
                </span>
              )}
            </div>
          </div>
          <span className="rounded bg-slate-950 px-3 py-1 text-xs font-mono text-slate-300">
            {visibleResults.length} of {activeResults.length} signals
          </span>
        </div>

        {scan.isLoading && (
          <div className="py-10 text-center text-sm text-slate-400">Scanning live Fyers quotes and history...</div>
        )}

        {scan.isError && (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 text-center text-sm text-rose-300">
            {scan.error instanceof Error ? scan.error.message : "Scanner failed. Check backend auth/Fyers availability, then run the scan again."}
          </div>
        )}

        {scanData?.busy && (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-center text-sm text-amber-200">
            {scanData.message || "Another stock scan is already running."}
          </div>
        )}

        {!scan.isLoading && !scan.isError && scanId === 0 && activeResults.length === 0 && (
          <div className="py-10 text-center text-sm text-slate-400">Choose filters and run your first scan.</div>
        )}

        {!scan.isLoading && !scan.isError && scanId > 0 && activeResults.length === 0 && (
          <div className="py-10 text-center text-sm text-slate-400">No signals found for this filter set.</div>
        )}

        {usingSavedResults && (
          <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
            Showing saved results from {savedAt ? new Date(savedAt).toLocaleString("en-IN") : "an earlier scan"}. Re-scan before reviewing a trade.
          </div>
        )}

        {activeResults.length > 0 && visibleResults.length === 0 && (
          <div className="py-8 text-center text-sm text-slate-400">Signals exist, but none match the current filters.</div>
        )}

        <div className="space-y-3">
          {visibleResults.map((stock, index) => {
            const confidence = numberValue(stock.confidence);
            const tone = confidenceTone(confidence);
            const volume = numberValue(stock.volume);

            return (
              <div key={`${stock.symbol}-${stock.signal}-${index}`} className={`rounded-xl border p-3 ${tone.card}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-bold text-white">{stock.symbol}</div>
                      <div className={`rounded px-2 py-0.5 text-xs font-bold ${stock.side === "BUY" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>
                        {stock.side}
                      </div>
                      <div className="rounded bg-slate-800/70 px-2 py-0.5 text-xs text-slate-300">{stock.signal}</div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
                      <span>LTP: <b className="text-white">{inr(numberValue(stock.ltp))}</b></span>
                      <span className={numberValue(stock.chp) >= 0 ? "text-emerald-400" : "text-rose-400"}>Change: <b>{pct(numberValue(stock.chp))}</b></span>
                      <span>Volume: <b className="font-mono text-slate-200">{volumeLabel(volume)}</b></span>
                    </div>
                  </div>
                  <div className={`text-2xl font-black ${tone.text}`} title="Rule-based confluence score; not a predicted probability of profit.">{confidence}/100</div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  {[
                    ["Entry", stock.entry, "text-emerald-300"],
                    ["T1", stock.t1, "text-cyan-300"],
                    ["T2", stock.t2, "text-cyan-300"],
                    ["SL", stock.sl, "text-rose-300"],
                  ].map(([label, value, color]) => (
                    <div key={label} className="rounded bg-slate-950/50 p-2 text-center">
                      <div className="mb-0.5 text-[10px] uppercase text-slate-500">{label}</div>
                      <div className={`font-bold ${color}`}>{inr(numberValue(value))}</div>
                    </div>
                  ))}
                </div>

                {stock.factors && (
                  <div className="mt-3 grid grid-cols-3 gap-1.5 text-[10px] md:grid-cols-6">
                    {FACTORS.map((factor) => (
                      <div key={factor} className="rounded bg-slate-950/60 p-1.5 text-center">
                        <div className="text-[9px] font-bold uppercase text-slate-500">{factor}</div>
                        <div className="font-bold text-slate-200">{stock.factors?.[factor] ?? "-"}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <button
                    onClick={() => setResearchSymbol(stock.symbol)}
                    title="Load this symbol into the analysis panel"
                    className={`rounded-lg py-2 text-xs font-bold uppercase text-white transition disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500 ${tone.button}`}
                  >
                    Analyse Symbol
                  </button>
                  <button
                    onClick={() => addWatchlist(stock.symbol)}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Watchlist
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
