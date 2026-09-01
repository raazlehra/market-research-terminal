import { useState } from "react";
import { BellRing, Plus, Trash2 } from "lucide-react";
import { inr } from "../lib/utils";

interface Alert {
  id: string;
  symbol: string;
  condition: "ABOVE" | "BELOW";
  price: number;
  active: boolean;
}

export default function Alerts() {
  const [alerts, setAlerts] = useState<Alert[]>([
    { id: "A1", symbol: "NSE:NIFTY50-INDEX", condition: "ABOVE", price: 24600, active: true },
    { id: "A2", symbol: "NSE:RELIANCE-EQ", condition: "BELOW", price: 2950, active: true },
    { id: "A3", symbol: "NSE:HDFCBANK-EQ", condition: "ABOVE", price: 1680, active: false }
  ]);

  const [symbol, setSymbol] = useState("");
  const [condition, setCondition] = useState<"ABOVE" | "BELOW">("ABOVE");
  const [price, setPrice] = useState("");

  function createAlert() {
    if (!symbol || !price) return;
    const next: Alert = {
      id: "A-" + Date.now(),
      symbol: symbol.toUpperCase(),
      condition,
      price: parseFloat(price) || 0,
      active: true
    };
    setAlerts([next, ...alerts]);
    setSymbol("");
    setPrice("");
  }

  function toggle(id: string) {
    setAlerts(alerts.map(a => a.id === id ? { ...a, active: !a.active } : a));
  }

  function remove(id: string) {
    setAlerts(alerts.filter(a => a.id !== id));
  }

  return (
    <div className="p-5 max-w-4xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <BellRing className="h-5 w-5 text-indigo-400" /> Price Level Alerts
        </h1>
        <p className="text-sm text-slate-500">Configure client-side browser notifications and trigger audio chimes.</p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
        <div className="text-xs font-bold text-slate-300">Set New Live Alert</div>
        <div className="flex flex-wrap gap-2">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="Symbol (e.g. NSE:RELIANCE-EQ)"
            className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none"
          />
          <select
            value={condition}
            onChange={(e: any) => setCondition(e.target.value)}
            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none"
          >
            <option value="ABOVE">Crosses Above</option>
            <option value="BELOW">Crosses Below</option>
          </select>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Target Price"
            className="w-32 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none"
          />
          <button
            onClick={createAlert}
            className="flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500"
          >
            <Plus className="h-4 w-4" /> Add Alert
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-800">
        <table className="w-full text-xs">
          <thead className="bg-slate-900 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Symbol</th>
              <th className="text-left">Condition</th>
              <th className="text-right">Target Price</th>
              <th className="text-center">Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {alerts.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-slate-500">No active alerts.</td></tr>}
            {alerts.map((a) => (
              <tr key={a.id} className="border-t border-slate-800/60 hover:bg-slate-800/30">
                <td className="px-3 py-2.5 font-bold text-white">{a.symbol}</td>
                <td>
                  <span className={`font-bold ${a.condition === "ABOVE" ? "text-emerald-400" : "text-rose-400"}`}>
                    {a.condition}
                  </span>
                </td>
                <td className="text-right font-mono font-bold text-slate-200">{inr(a.price)}</td>
                <td className="text-center">
                  <button
                    onClick={() => toggle(a.id)}
                    className={`rounded px-2 py-0.5 text-[10px] font-bold ${a.active ? "bg-emerald-500/10 text-emerald-400" : "bg-slate-800 text-slate-500"}`}
                  >
                    {a.active ? "ACTIVE" : "MUTED"}
                  </button>
                </td>
                <td className="text-right">
                  <button onClick={() => remove(a.id)} className="text-slate-600 hover:text-rose-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
