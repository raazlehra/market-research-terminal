import { cn, inr } from "../../lib/utils";

type OptionHeaderProps = {
  s1: number | undefined;
  s2: number | undefined;
  s1Strength: number;
  s2Strength: number;
  r1: number | undefined;
  r2: number | undefined;
  r1Strength: number;
  r2Strength: number;
  maxPain: number | null;
  ceWriter: boolean;
  peWriter: boolean;
  breakout: string;
  spot: number;
  vwap: number | null;
  ema20: number | null;
  ema50: number | null;
  pcr: number;
};

export function OptionHeader({
  s1,
  s2,
  s1Strength,
  s2Strength,
  r1,
  r2,
  r1Strength,
  r2Strength,
  maxPain,
  ceWriter,
  peWriter,
  breakout,
  spot,
  vwap,
  ema20,
  ema50,
  pcr,
}: OptionHeaderProps) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">Option Chain</h1>
          <span className="rounded bg-indigo-500/10 px-2 py-0.5 text-xs font-mono font-bold text-indigo-400 border border-indigo-500/20">
            Fyers API v3 Stream
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">Live OI, IV, Greeks with real-time Writer Unwind Signals</p>
      </div>

      <div className="flex items-center gap-2 text-xs flex-wrap">
        <span className="rounded bg-slate-800 px-2 py-1">S2 {s2} ({s2Strength}%)</span>
        <span className="rounded bg-slate-800 px-2 py-1">VWAP <span className="text-cyan-300">{vwap ? inr(vwap) : "--"}</span></span>
        <span className="rounded bg-slate-800 px-2 py-1">EMA20 <span className="text-emerald-300">{ema20 ? inr(ema20) : "--"}</span></span>
        <span className="rounded bg-slate-800 px-2 py-1">EMA50 <span className="text-amber-300">{ema50 ? inr(ema50) : "--"}</span></span>
        <span className="rounded bg-slate-800 px-2 py-1">S1 {s1} ({s1Strength}%)</span>
        <span className="rounded bg-slate-800 px-2 py-1">Spot <span className="text-indigo-300 font-bold">{inr(spot)}</span></span>
        <span className="rounded bg-slate-800 px-2 py-1">PCR <span className={pcr >= 1 ? "text-emerald-300 font-bold" : "text-rose-300 font-bold"}>{pcr.toFixed(2)}</span></span>
        <span className="rounded bg-slate-800 px-2 py-1">R1 {r1} ({r1Strength}%)</span>
        <span className="rounded bg-slate-800 px-2 py-1">R2 {r2} ({r2Strength}%)</span>
        <span className="rounded bg-slate-800 px-2 py-1">Max Pain {maxPain}</span>
        <span className="rounded bg-slate-800 px-2 py-1">{ceWriter ? "CE WRITERS ACTIVE" : "CE WEAK"}</span>
        <span className="rounded bg-slate-800 px-2 py-1">{peWriter ? "PE WRITERS ACTIVE" : "PE WEAK"}</span>
        <span className={cn(
          "rounded px-2 py-1 font-semibold",
          breakout === "BREAKOUT" && "bg-emerald-500/20 text-emerald-300",
          breakout === "BREAKDOWN" && "bg-rose-500/20 text-rose-300",
          breakout === "RANGE" && "bg-slate-800 text-slate-300"
        )}>
          {breakout}
        </span>
      </div>
    </div>
  );
}
