export type SummaryTone = "slate" | "emerald" | "amber" | "rose" | "indigo";

export function SummaryStat({ label, value, tone = "slate" }: { label: string; value: string | number; tone?: SummaryTone }) {
  const toneClass = {
    slate: "text-slate-200",
    emerald: "text-emerald-300",
    amber: "text-amber-300",
    rose: "text-rose-300",
    indigo: "text-indigo-300",
  }[tone];

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className={`mt-1 font-mono text-sm font-black ${toneClass}`}>{value}</div>
    </div>
  );
}

export function regimeToneClass(tone: "emerald" | "rose" | "amber" | "indigo" | "slate"): string {
  return {
    emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20",
    rose: "bg-rose-500/15 text-rose-300 border-rose-500/20",
    amber: "bg-amber-500/15 text-amber-300 border-amber-500/20",
    indigo: "bg-indigo-500/15 text-indigo-300 border-indigo-500/20",
    slate: "bg-slate-800 text-slate-300 border-slate-700",
  }[tone];
}

export function simulationStatusClass(status: string) {
  if (status === "T1" || status === "T2") return "bg-emerald-500/15 text-emerald-300";
  if (status === "SL") return "bg-rose-500/15 text-rose-300";
  if (status === "AMBIGUOUS") return "bg-amber-500/15 text-amber-300";
  return "bg-slate-800 text-slate-300";
}

export function evidenceClass(status: string) {
  if (status === "GUARDED") return "bg-rose-500/15 text-rose-300";
  if (status === "READY") return "bg-emerald-500/15 text-emerald-300";
  if (status === "BUILDING") return "bg-amber-500/15 text-amber-300";
  return "bg-slate-800 text-slate-300";
}
