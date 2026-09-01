import { inr } from "../../lib/utils";

function StatCard({ label, value, tone }: any) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{label}</div>
      <div className={`mt-1 text-lg font-black font-mono tracking-tight ${tone === "pos" ? "text-emerald-400" : tone === "neg" ? "text-rose-400" : "text-slate-100"}`}>{value ?? "-"}</div>
    </div>
  );
}

export function PaperSummaryCards({ summary }: { summary: any }) {
  const openPnl = summary.openPnl ?? 0;
  const netPnl = summary.netPnl ?? 0;
  const totalCharges = summary.totalCharges ?? 0;

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <StatCard label="Starting Balance" value={inr(summary.starting)} />
      <StatCard label="Cash Available" value={inr(summary.available)} />
      <StatCard label="Capital Used" value={inr(summary.used)} />
      <StatCard label="Open P&L" value={inr(openPnl)} tone={openPnl > 0 ? "pos" : openPnl < 0 ? "neg" : undefined} />
      <StatCard label="Charges" value={inr(totalCharges)} tone={totalCharges > 0 ? "neg" : undefined} />
      <StatCard label="Net P&L" value={inr(netPnl)} tone={netPnl > 0 ? "pos" : netPnl < 0 ? "neg" : undefined} />
    </div>
  );
}
