import type React from "react";

export function StatusPill({ status }: { status?: string }) {
  const s = (status || "").toUpperCase();
  if (s.includes("FILLED") || s.includes("COMPLETE") || s === "TRADED") {
    return <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300 border border-emerald-500/20">FILLED</span>;
  }
  if (s.includes("OPEN") || s.includes("PENDING")) {
    return <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-500/20">OPEN</span>;
  }
  return <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-400">{status || "UNKNOWN"}</span>;
}

export function StatCard({
  icon,
  label,
  value,
  hint,
  valueClass = "text-white",
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint: React.ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-4">
      <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500 flex items-center gap-1.5">
        {icon}
        {label}
      </div>
      <div className={`mt-2 text-xl font-black font-mono tracking-tight ${valueClass}`}>{value}</div>
      <div className="mt-1 text-[10px] text-slate-400">{hint}</div>
    </div>
  );
}

