import { inr, pct } from "../../lib/utils";

export function InfoCard({ label, value, tone }: { label: string; value: string; tone?: number }) {
  const textClass = tone === undefined ? "text-slate-100" : tone > 0 ? "text-emerald-400" : tone < 0 ? "text-rose-400" : "text-slate-400";
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
      <div className="text-[11px] uppercase tracking-[0.3em] text-slate-500">{label}</div>
      <div className={`mt-2 font-semibold ${textClass}`}>{value}</div>
    </div>
  );
}

export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm text-slate-300">
      <span>{label}</span>
      <span className="font-semibold text-white">{value}</span>
    </div>
  );
}

export function RiskPanel({
  entryPrice,
  sl,
  t1,
  t2,
  trailSl,
  riskPerLot,
  rewardT1PerLot,
  rewardT2PerLot,
  rr1,
  rr2,
}: {
  entryPrice: number;
  sl: number;
  t1: number;
  t2: number;
  trailSl?: boolean;
  riskPerLot: number;
  rewardT1PerLot: number;
  rewardT2PerLot: number;
  rr1: number;
  rr2: number;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
      <h4 className="text-xs uppercase tracking-[0.3em] text-slate-500">Risk Management</h4>
      <DetailRow label="Entry" value={inr(entryPrice)} />
      <DetailRow label="Stop Loss" value={inr(sl)} />
      <DetailRow label="Target 1" value={inr(t1)} />
      <DetailRow label="Target 2" value={inr(t2)} />
      <DetailRow label="Auto Trail SL" value={trailSl ? "On" : "Off"} />
      <div className="mt-3 rounded-lg bg-slate-950/80 p-3 text-sm text-slate-300">
        <div className="flex items-center justify-between text-slate-400"><span>Risk / Lot</span><span>{inr(riskPerLot)}</span></div>
        <div className="flex items-center justify-between text-slate-400"><span>Reward T1 / Lot</span><span>{inr(rewardT1PerLot)}</span></div>
        <div className="flex items-center justify-between text-slate-400"><span>Reward T2 / Lot</span><span>{inr(rewardT2PerLot)}</span></div>
        <div className="flex items-center justify-between text-slate-400"><span>R:R T1</span><span>{rr1.toFixed(2)}</span></div>
        <div className="flex items-center justify-between text-slate-400"><span>R:R T2</span><span>{rr2.toFixed(2)}</span></div>
      </div>
    </div>
  );
}

export function PnlPanel({
  investment,
  maxRisk,
  potentialT1,
  potentialT2,
  currentLtp,
  entryPrice,
  qty,
  mtmPercent,
}: {
  investment: number;
  maxRisk: number;
  potentialT1: number;
  potentialT2: number;
  currentLtp: number;
  entryPrice: number;
  qty: number;
  mtmPercent: number;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
      <h4 className="text-xs uppercase tracking-[0.3em] text-slate-500">PnL Preview</h4>
      <DetailRow label="Investment Required" value={inr(investment)} />
      <DetailRow label="Maximum Risk" value={inr(maxRisk)} />
      <DetailRow label="Potential T1 Profit" value={inr(potentialT1)} />
      <DetailRow label="Potential T2 Profit" value={inr(potentialT2)} />
      <DetailRow label="Position MTM" value={inr((currentLtp - entryPrice) * qty)} />
      <DetailRow label="MTM %" value={pct(mtmPercent)} />
    </div>
  );
}
