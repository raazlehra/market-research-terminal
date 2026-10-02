import { inr } from "../../lib/utils";
import type { ChartRuleResult } from "../../lib/chartRules";
import type { ExpiryRuleResult } from "../../lib/expiryRules";
import type { OptionLiquidityResult } from "../../lib/liquidityRules";

type MarketBiasCardProps = {
  bias: string;
  confluenceScore: number;
  confluenceBreakdown: { flow: number; contract: number; chart: number };
  recommendedOption: any;
  recommendedEntryPrice: number;
  recommendedSL: number;
  recommendedT1: number;
  recommendedT2: number;
  expiryRule: ExpiryRuleResult;
  liquidityRule: OptionLiquidityResult;
  chartRule: ChartRuleResult;
};

function Metric({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "good" | "bad" }) {
  const color = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-rose-300" : "text-slate-100";
  return (
    <div className="min-w-0 border-l border-slate-800 pl-3 first:border-l-0 first:pl-0">
      <div className="truncate text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-0.5 truncate text-xs font-semibold ${color}`} title={value}>{value}</div>
    </div>
  );
}

function RuleRow({ label, value, score, ok }: { label: string; value: string; score: number; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 text-[11px]">
      <span className="text-slate-500">{label}</span>
      <span className={ok ? "text-emerald-300" : "text-amber-300"}>{value} · {score}</span>
    </div>
  );
}

export function MarketBiasCard({
  bias,
  confluenceScore,
  confluenceBreakdown,
  recommendedOption,
  recommendedEntryPrice,
  recommendedSL,
  recommendedT1,
  recommendedT2,
  expiryRule,
  liquidityRule,
  chartRule,
}: MarketBiasCardProps) {
  const maxRisk = recommendedEntryPrice && recommendedSL
    ? Math.max(0, recommendedEntryPrice - recommendedSL)
    : 0;
  const targetProfit = recommendedEntryPrice && recommendedT2
    ? Math.max(0, recommendedT2 - recommendedEntryPrice)
    : 0;
  const rewardRisk = maxRisk > 0 ? targetProfit / maxRisk : 0;
  const optionSide = recommendedOption?.side || "--";
  const strike = recommendedOption?.row?.strike;
  const gateCount = [
    confluenceScore >= 65,
    expiryRule.tradeable,
    liquidityRule.tradeable,
    chartRule.tradeable,
  ].filter(Boolean).length;
  const candidateReady = Boolean(recommendedOption) && gateCount === 4;
  const biasTone = bias === "Bullish"
    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
    : bias === "Bearish"
      ? "border-rose-500/20 bg-rose-500/10 text-rose-300"
      : "border-slate-700 bg-slate-800 text-slate-300";

  return (
    <div className="mb-3 grid overflow-hidden rounded-xl border border-slate-800 bg-slate-950/75 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 p-3 xl:border-r xl:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Market Bias Engine</span>
            <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${biasTone}`}>{bias}</span>
            <span className="text-[10px] text-slate-500">Gates <b className={candidateReady ? "text-emerald-300" : "text-amber-300"}>{gateCount}/4</b></span>
            <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${confluenceScore >= 65 ? "bg-emerald-500/15 text-emerald-300" : confluenceScore >= 50 ? "bg-amber-500/15 text-amber-300" : "bg-rose-500/15 text-rose-300"}`}>
              CONFLUENCE {confluenceScore}/100
            </span>
          </div>
          <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${candidateReady ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
            {candidateReady ? "ANALYTICAL SETUP" : recommendedOption ? "FILTERED" : "NO SETUP"}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-y-3 sm:grid-cols-6">
          <Metric label="Candidate" value={recommendedOption ? `${optionSide} ${strike}` : "No setup"} />
          <Metric label="Entry" value={recommendedEntryPrice ? inr(recommendedEntryPrice) : "--"} />
          <Metric label="Stop" value={recommendedSL ? inr(recommendedSL) : "--"} tone="bad" />
          <Metric label="Targets" value={recommendedT1 ? `${inr(recommendedT1)} / ${inr(recommendedT2)}` : "--"} tone="good" />
          <Metric label="Risk / T2 (unit)" value={maxRisk ? `${inr(maxRisk)} / ${inr(targetProfit)}` : "--"} />
          <Metric label="R:R / Score" value={`${rewardRisk ? `${rewardRisk.toFixed(2)}x` : "--"} / ${confluenceScore}/100`} />
        </div>

        <div className="mt-3 grid gap-x-6 border-t border-slate-800 pt-2 sm:grid-cols-3">
          <RuleRow label="Expiry" value={expiryRule.label} score={expiryRule.score} ok={expiryRule.tradeable} />
          <RuleRow label="Liquidity" value={liquidityRule.label} score={liquidityRule.score} ok={liquidityRule.tradeable} />
          <RuleRow label="Chart" value={chartRule.label} score={chartRule.score} ok={chartRule.tradeable} />
        </div>
        <div className="mt-1 text-[10px] text-slate-600">
          Rule-based confluence score; not a predicted probability of profit. Flow {confluenceBreakdown.flow}/100 · Contract {confluenceBreakdown.contract}/100 · Chart {confluenceBreakdown.chart}/100
        </div>

        <div className="mt-2 border-t border-slate-800 pt-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">View only · contract analytics cannot open or stage an order</div>
      </section>

    </div>
  );
}
