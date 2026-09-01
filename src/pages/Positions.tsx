import { usePositions } from "../hooks";
import { inr, signColor } from "../lib/utils";
import { useTicket } from "../stores";
import { Plus, Minus, FlipHorizontal } from "lucide-react";

export default function Positions() {
  const q = usePositions();
  const openTicket = useTicket((s) => s.openFor);
  
  const positions: any[] = q.data?.positions ?? [];
  const open = positions.filter((p) => Math.abs(p.netQty ?? p.quantity ?? 0) > 0);
  const closed = positions.filter((p) => Math.abs(p.netQty ?? p.quantity ?? 0) === 0);
  const totalMtm = positions.reduce((s, p) => s + (p.pl ?? p.unrealized_profit ?? 0), 0);

  return (
    <div className="p-5 animate-in fade-in duration-200">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Positions</h1>
          <p className="text-sm text-slate-500">
            {open.length} open • MTM <span className={`font-mono font-bold ${signColor(totalMtm)}`}>{inr(totalMtm)}</span>
          </p>
        </div>
      </div>

      <div className="overflow-auto rounded-lg border border-slate-800">
        <table className="w-full text-xs">
          <thead className="bg-slate-900 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Symbol</th>
              <th className="text-left">Product</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Avg</th>
              <th className="text-right">LTP</th>
              <th className="text-right">Day MTM</th>
              <th className="text-right">Net MTM</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {open.length === 0 && (
              <tr><td colSpan={8} className="py-8 text-center text-slate-500">No open positions.</td></tr>
            )}
            {open.map((p, i) => {
              const qty = p.netQty ?? p.quantity ?? 0;
              const pnl = p.pl ?? p.unrealized_profit ?? 0;
              const dayPnl = p.realized_profit ?? 0;
              return (
                <tr key={i} className="border-t border-slate-800/60 hover:bg-slate-800/30 transition">
                  <td className="px-3 py-2.5 font-bold text-white">{p.symbol}</td>
                  <td><span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-300">{p.productType || "INTRADAY"}</span></td>
                  <td className={`text-right font-mono font-bold ${qty > 0 ? "text-emerald-400" : "text-rose-400"}`}>{qty}</td>
                  <td className="text-right font-mono text-slate-300">{inr(p.avgPrice ?? p.averagePrice)}</td>
                  <td className="text-right font-mono text-slate-100">{inr(p.ltp)}</td>
                  <td className={`text-right font-mono ${signColor(dayPnl)}`}>{inr(dayPnl)}</td>
                  <td className={`text-right font-mono font-bold ${signColor(pnl)}`}>{inr(pnl)}</td>
                  <td className="text-right">
                    <button title="Add" onClick={() => openTicket({ symbol: p.symbol, side: qty > 0 ? "BUY" : "SELL", qty: 1, orderType: "MARKET", product: p.productType })} className="text-indigo-400 hover:text-indigo-300">
                      <Plus className="inline h-3.5 w-3.5" />
                    </button>
                    <button title="Reduce" onClick={() => openTicket({ symbol: p.symbol, side: qty > 0 ? "SELL" : "BUY", qty: 1, orderType: "MARKET", product: p.productType })} className="ml-2 text-amber-400 hover:text-amber-300">
                      <Minus className="inline h-3.5 w-3.5" />
                    </button>
                    <button title="Reverse" onClick={() => openTicket({ symbol: p.symbol, side: qty > 0 ? "SELL" : "BUY", qty: Math.abs(qty) * 2, orderType: "MARKET", product: p.productType })} className="ml-2 text-purple-400 hover:text-purple-300">
                      <FlipHorizontal className="inline h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {closed.length > 0 && (
        <>
          <h2 className="mt-6 mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Closed Today</h2>
          <div className="overflow-auto rounded-lg border border-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-900 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Symbol</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Realized P&L</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((p, i) => (
                  <tr key={i} className="border-t border-slate-800/60">
                    <td className="px-3 py-2 font-medium text-white">{p.symbol}</td>
                    <td className="text-right font-mono text-slate-400">{p.netQty ?? p.quantity}</td>
                    <td className={`text-right font-mono font-bold ${signColor(p.realized_profit ?? 0)}`}>{inr(p.realized_profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
