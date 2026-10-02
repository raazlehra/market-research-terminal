import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BrainCircuit, ChevronDown, ShieldCheck } from "lucide-react";
import { api, type AnalysisResult, type AssetType } from "../lib/api";

type Props = {
  assetType: AssetType;
  symbol: string;
  expiry?: string;
  resolution?: string;
  horizons: string[];
  horizon: string;
  onHorizonChange: (value: string) => void;
};

type ResearchDepth = "quick" | "standard" | "deep";

export function AnalysisPanel({ assetType, symbol, expiry, resolution, horizons, horizon, onHorizonChange }: Props) {
  const [researchDepth, setResearchDepth] = useState<ResearchDepth>("standard");
  const config = useQuery({ queryKey: ["analysis-config"], queryFn: () => api.getAnalysisConfig(), staleTime: 60_000 });
  const analysis = useMutation({
    mutationFn: () => api.runAnalysis({ asset_type: assetType, symbol, expiry, resolution, horizon, research_depth: researchDepth, ai_requested: true }),
  });
  const result = analysis.data;
  const aiEnabled = config.data?.enabled === true;

  return (
    <section className="rounded-2xl border border-indigo-500/20 bg-slate-900/55 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-white"><BrainCircuit className="h-4 w-4 text-indigo-300" />Multi-Agent Analysis</div>
          <p className="mt-1 text-xs text-slate-400">Explicit, cached research run over one verified market snapshot. Dashboard refreshes never invoke an LLM.</p>
          <div className={`mt-2 text-[10px] ${aiEnabled ? "text-emerald-300" : "text-amber-300"}`}>
            {config.isLoading ? "Checking optional AI configuration…" : config.isError ? "AI configuration unavailable; deterministic analysis remains available." : `${config.data?.framework || "TradingAgents"} · ${config.data?.provider || "not configured"} / ${config.data?.model || "not configured"} · ${config.data?.cost_notice || ""}`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-slate-400">Horizon <select value={horizon} onChange={(event) => onHorizonChange(event.target.value)} className="ml-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-white">{horizons.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-xs text-slate-400">Depth <select value={researchDepth} onChange={(event) => setResearchDepth(event.target.value as ResearchDepth)} className="ml-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-white"><option value="quick">Quick</option><option value="standard">Standard</option><option value="deep">Deep</option></select></label>
          <button onClick={() => analysis.mutate()} disabled={!symbol || analysis.isPending} title={aiEnabled ? "Run optional AI reasoning over the current bounded snapshot" : "No LLM is configured; the backend will use deterministic analysis"} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50">{analysis.isPending ? "Analysing…" : "Run AI Analysis"}</button>
        </div>
      </div>

      {researchDepth === "deep" && <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-[10px] text-amber-200">Deep mode uses additional bull/bear counter-analysis rounds when an LLM is configured and can consume more tokens or provider quota.</div>}
      {analysis.isError && <div className="mt-4 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-200">{analysis.error instanceof Error ? analysis.error.message : "Analysis failed."}</div>}
      {!result && !analysis.isPending && <div className="mt-5 rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">Market data loads independently. Run analysis only when you want the structured research report.</div>}
      {result && <AnalysisResultView result={result} />}
    </section>
  );
}

function AnalysisResultView({ result }: { result: AnalysisResult }) {
  const positive = result.market_bias === "BULLISH";
  const negative = result.market_bias === "BEARISH";
  return (
    <div className="mt-5 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Analysis Signal" value={result.signal} tone={positive ? "text-emerald-300" : negative ? "text-rose-300" : "text-amber-300"} />
        <Metric label="Confidence" value={`${result.confidence}/100`} />
        <Metric label="Market Bias" value={result.market_bias} />
        <Metric label="Horizon" value={result.horizon} />
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-3 py-2 text-xs text-emerald-200"><ShieldCheck className="h-4 w-4" /><b>VIEW ONLY</b><span>Analysis only — no orders are placed.</span><span className="ml-auto font-mono text-[10px]">execution_enabled: false</span></div>
      <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/8 px-3 py-2 text-xs text-indigo-100"><b>{result.analysis_mode === "llm" ? "LLM analysis completed" : "Deterministic analysis"}</b><span className="ml-2 text-indigo-200/75">{result.model} · AI status: {result.ai_status} · depth: {result.research_depth}</span><div className="mt-1 text-[10px] text-slate-400">{result.cost_notice}</div></div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Evidence title="Bull Case" items={result.bullish_evidence} tone="text-emerald-300" />
        <Evidence title="Bear Case" items={result.bearish_evidence} tone="text-rose-300" />
        <Evidence title="Risk Factors" items={result.risks} tone="text-amber-300" />
        <Evidence title="Invalidation / Re-check" items={result.invalidation_conditions} tone="text-sky-300" />
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Metric label="Technical" value={result.technical_condition} />
        <Metric label="Volume" value={result.volume_condition} />
        <Metric label="Volatility" value={result.volatility} />
        <Metric label="News / Sentiment" value={result.sentiment_news_condition} />
      </div>
      {(result.futures_confirmation || result.options_oi_confirmation) && <div className="grid gap-3 md:grid-cols-2"><Metric label="Futures Confirmation" value={result.futures_confirmation || "Unavailable"} /><Metric label="Options / OI" value={result.options_oi_confirmation || "Unavailable"} /></div>}
      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4"><div className="text-xs font-bold uppercase tracking-wider text-indigo-300">Final Analysis</div><p className="mt-2 text-sm leading-6 text-slate-300">{result.reasoning_summary}</p></div>
      <details className="rounded-xl border border-slate-800 bg-slate-950/30 p-4"><summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-bold text-slate-300"><ChevronDown className="h-4 w-4" />Agent evidence</summary><div className="mt-3 space-y-3">{result.agents.map((agent) => <div key={agent.agent} className="border-l-2 border-slate-700 pl-3"><div className="text-xs font-bold text-white">{agent.agent}</div><div className="mt-1 text-xs text-slate-400">{agent.conclusion}</div></div>)}</div></details>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-slate-500"><span>{result.data_freshness}</span><span>Market data: {new Date(result.data_timestamp).toLocaleString("en-IN")}</span><span>Generated: {new Date(result.generated_at).toLocaleString("en-IN")}</span><span>Sources: {result.data_sources.join(", ")}</span><span>{result.cached ? "Cached analysis" : "New analysis"}</span></div>
    </div>
  );
}

function Metric({ label, value, tone = "text-white" }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-950/45 p-3"><div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div><div className={`mt-1 text-sm font-bold ${tone}`}>{value}</div></div>;
}

function Evidence({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-950/35 p-4"><div className={`text-xs font-bold uppercase tracking-wider ${tone}`}>{title}</div><ul className="mt-2 space-y-1.5 text-xs leading-5 text-slate-300">{items.map((item, index) => <li key={`${title}-${index}`}>• {item}</li>)}</ul></div>;
}