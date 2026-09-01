import { inr } from "../../lib/utils";
import type { ChartStudyPoint } from "./chartData";

export function ChartTooltip({ active, payload }: any) {
  const p = payload?.[0]?.payload as ChartStudyPoint | undefined;
  if (!active || !p) return null;

  return (
    <div className="rounded border border-slate-700 bg-slate-950/95 p-3 text-xs shadow-xl">
      <div className="mb-2 font-mono text-slate-300">{p.label}{p.live ? " live" : ""}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
        <span className="text-slate-500">Open</span><span className="text-right text-slate-100">{inr(p.open)}</span>
        <span className="text-slate-500">High</span><span className="text-right text-emerald-300">{inr(p.high)}</span>
        <span className="text-slate-500">Low</span><span className="text-right text-rose-300">{inr(p.low)}</span>
        <span className="text-slate-500">Close</span><span className="text-right text-white">{inr(p.close)}</span>
        <span className="text-slate-500">Volume</span><span className="text-right text-slate-300">{Math.round(p.volume).toLocaleString("en-IN")}</span>
        {p.rsi !== null && <><span className="text-slate-500">RSI 14</span><span className="text-right text-violet-300">{p.rsi.toFixed(1)}</span></>}
      </div>
    </div>
  );
}

