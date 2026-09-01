import { useState } from "react";
import { useOrders } from "../hooks";
import { StatusPill } from "./Dashboard";
import { inr, fmtTime } from "../lib/utils";

export default function Orders() {
  const q = useOrders();
  const [filter, setFilter] = useState<"ALL" | "OPEN" | "COMPLETE" | "REJECTED">("ALL");

  const ords: any[] = q.data?.orders ?? [];
  const shown = ords.filter((o) => {
    const s = (o.status || "").toUpperCase();
    if (filter === "ALL") return true;
    if (filter === "OPEN") return s.includes("OPEN") || s.includes("PENDING") || s.includes("TRIGGER");
    if (filter === "COMPLETE") return s.includes("COMPLETE") || s === "TRADED";
    if (filter === "REJECTED") return s.includes("REJECT") || s.includes("CANCEL");
    return true;
  });

  return (
    <div className="p-5 animate-in fade-in duration-200">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Order Book</h1>
          <p className="text-sm text-slate-500">{ords.length} orders today • synced with Fyers</p>
        </div>
        <div className="flex gap-1 text-xs">
          {(["ALL", "OPEN", "COMPLETE", "REJECTED"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 font-bold transition ${filter === f ? "bg-indigo-600 text-white" : "bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-white"}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-auto rounded-lg border border-slate-800">
        <table className="w-full text-xs">
          <thead className="bg-slate-900 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="text-left">Symbol</th>
              <th className="text-left">Type</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Price</th>
              <th className="text-right">Trigger</th>
              <th className="text-right">LTP</th>
              <th className="text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={8} className="py-8 text-center text-slate-500">
                {q.isLoading ? "Loading orders…" : "No orders in this filter."}
              </td></tr>
            )}
            {shown.map((o) => {
              return (
                <tr key={o.id} className="border-t border-slate-800/60 hover:bg-slate-800/30 transition">
                  <td className="px-3 py-2 text-slate-500 font-mono">{fmtTime(o.orderDateTime ?? o.order_date)}</td>
                  <td className="font-bold text-white">{o.symbol}</td>
                  <td>
                    <span className="font-mono text-slate-400">
                      {o.type === 2 ? "MKT" : o.type === 1 ? "LMT" : o.type === 3 ? "SL" : "SL-M"} {o.side === 1 ? "BUY" : "SELL"}
                    </span>
                  </td>
                  <td className="text-right font-mono">
                    {o.qty ?? o.quantity}
                  </td>
                  <td className="text-right font-mono">
                    {inr(o.limitPrice ?? o.price)}
                  </td>
                  <td className="text-right text-slate-400 font-mono">{inr(o.stopPrice)}</td>
                  <td className="text-right font-mono text-slate-300">{inr(o.ltp)}</td>
                  <td><StatusPill status={o.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
