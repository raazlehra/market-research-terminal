import { fmtTime, inr, signColor } from "../../lib/utils";

export function PaperActivityTables({
  trades,
  orders,
  showTrades = true,
  showOrders = true,
}: {
  trades: any[];
  orders: any[];
  showTrades?: boolean;
  showOrders?: boolean;
}) {
  const safeTrades = Array.isArray(trades) ? trades : [];
  const safeOrders = Array.isArray(orders) ? orders : [];

  return (
    <>
      {showTrades && (
      <div className="rounded-lg border border-slate-800">
        <div className="border-b border-slate-800 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-400">Recent Paper Fills</div>
        <table className="w-full text-xs">
          <thead className="bg-slate-900 text-[10px] uppercase tracking-wider text-slate-500">
            <tr><th className="px-3 py-2 text-left">Time</th><th className="text-left">Symbol</th><th className="text-left">Side</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Charges</th></tr>
          </thead>
          <tbody>
            {safeTrades.slice(0, 10).map((t) => (
              <tr key={t.id} className="border-t border-slate-800/60 hover:bg-slate-800/30">
                <td className="px-3 py-1.5 text-slate-500 font-mono">{fmtTime(t.time)}</td>
                <td className="font-bold text-white">{t.symbol}</td>
                <td className={signColor(t.side === "BUY" ? 1 : -1)}>{t.side}</td>
                <td className="text-right font-mono text-slate-200">{t.qty}</td>
                <td className="text-right font-mono font-bold text-slate-100">{inr(t.price)}</td>
                <td className="text-right font-mono text-slate-400">{inr(t.charges)}</td>
              </tr>
            ))}
            {safeTrades.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-500">No paper fills yet.</td></tr>}
          </tbody>
        </table>
      </div>
      )}

      {showOrders && (
      <div className="rounded-lg border border-slate-800">
        <div className="border-b border-slate-800 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-400">Paper Order Book</div>
        <table className="w-full text-xs">
          <thead className="bg-slate-900 text-[10px] uppercase tracking-wider text-slate-500">
            <tr><th className="px-3 py-2 text-left">Time</th><th className="text-left">Symbol</th><th className="text-left">Type</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-left">Status</th></tr>
          </thead>
          <tbody>
            {safeOrders.map((o) => (
              <tr key={o.id} className="border-t border-slate-800/60 hover:bg-slate-800/30">
                <td className="px-3 py-1.5 text-slate-500 font-mono">{fmtTime(o.time)}</td>
                <td className="font-bold text-white">{o.symbol}</td>
                <td className="font-mono text-slate-400">{o.orderType} {o.side}</td>
                <td className="text-right font-mono text-slate-200">{o.qty}</td>
                <td className="text-right font-mono font-bold text-slate-100">{inr(o.price)}</td>
                <td><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${o.status === "FILLED" ? "bg-emerald-500/15 text-emerald-300" : o.status === "OPEN" ? "bg-amber-500/15 text-amber-300" : "bg-slate-700/40 text-slate-300"}`}>{o.status}</span></td>
              </tr>
            ))}
            {safeOrders.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-slate-500">No paper orders yet.</td></tr>}
          </tbody>
        </table>
      </div>
      )}
    </>
  );
}
