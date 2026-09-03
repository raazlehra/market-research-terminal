import { Sparkles, TrendingUp } from "lucide-react";
import { cn, inr, num } from "../../lib/utils";
import { ConfidenceResult } from "../../lib/optionChainConfidence";

type SignalBannerProps = {
  spot: number;
  vwap: number | null;
  ema20: number | null;
  ema50: number | null;
  effectiveAtm: number | null;
  atmCeConfidence: ConfidenceResult | null;
  atmPeConfidence: ConfidenceResult | null;
  pcr: number;
};

export function SignalBanner({
  spot,
  vwap,
  effectiveAtm,
  atmCeConfidence,
  atmPeConfidence,
  pcr,
}: SignalBannerProps) {
  return (
    <div className="mb-3 grid grid-cols-1 md:grid-cols-4 gap-3">
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-2.5 flex items-center gap-2.5 text-slate-300">
        <TrendingUp className="h-4 w-4 shrink-0 text-cyan-400" />
        <div className="min-w-0 text-[10px] font-mono">
          <div className="font-bold">TREND:</div>
          <div className="opacity-75">Spot <span className="text-indigo-300">{inr(spot)}</span> {spot > (vwap || 0) ? ">" : "<"} VWAP</div>
        </div>
      </div>

      {effectiveAtm && atmCeConfidence && (
        <div className={cn(
          "rounded-xl border p-2.5 flex items-center justify-between",
          atmCeConfidence.strength === "VERY_STRONG" && "border-emerald-500/40 bg-emerald-500/10",
          atmCeConfidence.strength === "STRONG" && "border-emerald-500/30 bg-emerald-500/5",
          atmCeConfidence.strength === "MODERATE" && "border-slate-700 bg-slate-800/40",
          atmCeConfidence.strength === "WEAK" && "border-slate-800 bg-slate-900/40"
        )}>
          <div className="flex items-center gap-2">
            <Sparkles className={cn(
              "h-4 w-4",
              atmCeConfidence.strength === "VERY_STRONG" && "text-emerald-400",
              atmCeConfidence.strength === "STRONG" && "text-emerald-400",
              atmCeConfidence.strength === "WEAK" && "text-slate-400"
            )} />
            <div>
              <div className="text-[10px] uppercase font-bold tracking-wider text-emerald-400">ATM {effectiveAtm ? num(effectiveAtm, 0) : "--"} CE Signal Strength</div>
              <div className="text-[9px] text-slate-400 font-mono">T:{atmCeConfidence?.factors?.trendAlignment ?? 0} G:{atmCeConfidence?.factors?.greeksFavor ?? 0} IV:{atmCeConfidence?.factors?.ivExtreme ?? 0}</div>
            </div>
          </div>
          <div className="text-right">
            <span className={cn(
              "text-lg font-black",
              atmCeConfidence.strength === "VERY_STRONG" && "text-emerald-400",
              atmCeConfidence.strength === "STRONG" && "text-emerald-400",
              atmCeConfidence.strength === "WEAK" && "text-slate-400"
            )}>{atmCeConfidence.score}/100</span>
          </div>
        </div>
      )}

      {effectiveAtm && atmPeConfidence && (
        <div className={cn(
          "rounded-xl border p-2.5 flex items-center justify-between",
          atmPeConfidence.strength === "VERY_STRONG" && "border-rose-500/40 bg-rose-500/10",
          atmPeConfidence.strength === "STRONG" && "border-rose-500/30 bg-rose-500/5",
          atmPeConfidence.strength === "MODERATE" && "border-slate-700 bg-slate-800/40",
          atmPeConfidence.strength === "WEAK" && "border-slate-800 bg-slate-900/40"
        )}>
          <div className="flex items-center gap-2">
            <Sparkles className={cn(
              "h-4 w-4",
              atmPeConfidence.strength === "VERY_STRONG" && "text-rose-400",
              atmPeConfidence.strength === "STRONG" && "text-rose-400",
              atmPeConfidence.strength === "WEAK" && "text-slate-400"
            )} />
            <div>
              <div className="text-[10px] uppercase font-bold tracking-wider text-rose-400">ATM {effectiveAtm ? num(effectiveAtm, 0) : "--"} PE Signal Strength</div>
              <div className="text-[9px] text-slate-400 font-mono">T:{atmPeConfidence?.factors?.trendAlignment ?? 0} G:{atmPeConfidence?.factors?.greeksFavor ?? 0} IV:{atmPeConfidence?.factors?.ivExtreme ?? 0}</div>
            </div>
          </div>
          <div className="text-right">
            <span className={cn(
              "text-lg font-black",
              atmPeConfidence.strength === "VERY_STRONG" && "text-rose-400",
              atmPeConfidence.strength === "STRONG" && "text-rose-400",
              atmPeConfidence.strength === "WEAK" && "text-slate-400"
            )}>{atmPeConfidence.score}/100</span>
          </div>
        </div>
      )}

      <div className={cn(
        "rounded-xl border p-2.5 flex items-center justify-between",
        pcr > 1.1 && "border-emerald-500/30 bg-emerald-500/5",
        pcr < 0.9 && "border-rose-500/30 bg-rose-500/5",
        pcr >= 0.9 && pcr <= 1.1 && "border-slate-800 bg-slate-900/40"
      )}>
        <div>
          <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400">PCR Ratio</div>
          <div className="text-[9px] text-slate-400">Put-Call OI Ratio</div>
        </div>
        <div className="text-right">
          <span className={cn(
            "text-lg font-black",
            pcr > 1.1 && "text-emerald-400",
            pcr < 0.9 && "text-rose-400",
            pcr >= 0.9 && pcr <= 1.1 && "text-slate-400"
          )}>{pcr.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
}
