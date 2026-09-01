import { useState } from "react";
import { useReports } from "../hooks";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import { inr, signColor } from "../lib/utils";
import { Download, BarChart3 } from "lucide-react";

export default function Reports() {
  const [range, setRange] = useState("30d");
  const q = useReports(range);
  const r: any = q.data ?? {};
  const daily: any[] = r.daily ?? [];
  const strat: any[] = r.by_strategy ?? [];
  const totals = r.totals ?? {};

  const colors = ["#6366f1", "#8b5cf6", "#ec4899", "#10b981", "#f59e0b", "#ef4444"];

  function download() {
    const rows = [["Date", "P&L", "Trades", "Win Rate"], ...daily.map((d: any) => [d.date, d.pnl, d.trades, d.win_rate])];
    const csv = rows.map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); 
    a.href = URL.createObjectURL(blob); 
    a.download = `report-${range}.csv`; 
    a.click();
  }

  return (
    <div className="p-5 animate-in fade-in duration-200">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-indigo-400" /> Reports & Performance
          </h1>
          <p className="text-sm text-slate-500">Daily, weekly, and strategy-level analytics</p>
        </div>
        <div className="flex gap-2">
          {(["7d", "30d", "90d", "1y", "all"] as const).map((rg) => (
            <button 
              key={rg} 
              onClick={() => setRange(rg)} 
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${range === rg ? "bg-indigo-600 text-white" : "bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-white"}`}
            >
              {rg}
            </button>
          ))}
          <button onClick={download} className="flex items-center gap-1 rounded-lg bg-slate-900 border border-slate-800 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800">
            <Download className="h-3 w-3" /> CSV
          </button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card label="Total Net P&L" value={inr(totals.net_pnl)} tone={(totals.net_pnl ?? 0) > 0 ? "pos" : "neg"} />
        <Card label="Gross P&L" value={inr(totals.gross_pnl)} />
        <Card label="Est. Charges" value={inr(totals.charges)} tone="neg" />
        <Card label="Total Trades" value={String(totals.trades ?? 0)} />
        <Card label="Average Win Rate" value={`${((totals.win_rate ?? 0) * 100).toFixed(1)}%`} tone="pos" />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="mb-3 text-xs font-bold text-slate-300 uppercase tracking-wider">Daily P&L Distribution</h3>
          <div className="h-64">
            {daily.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">{q.isLoading ? "Loading reports…" : "No trades in this period."}</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily}>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#475569" fontSize={10} />
                  <YAxis stroke="#475569" fontSize={10} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", fontSize: 12 }} />
                  <Bar dataKey="pnl">
                    {daily.map((d: any, i: number) => <Cell key={i} fill={d.pnl >= 0 ? "#10b981" : "#f43f5e"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <h3 className="mb-3 text-xs font-bold text-slate-300 uppercase tracking-wider">Cumulative Equity Curve</h3>
          <div className="h-64">
            {daily.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={daily}>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="#475569" fontSize={10} />
                  <YAxis stroke="#475569" fontSize={10} />
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", fontSize: 12 }} />
                  <Line type="monotone" dataKey="cumulative" stroke="#6366f1" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <h3 className="mb-3 text-xs font-bold text-slate-300 uppercase tracking-wider">Performance by Tagged Strategy</h3>
        {strat.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">Tag trades in the Journal to see strategy breakdown.</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 items-center">
            <div>
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-slate-500">
                  <tr><th className="py-2 text-left">Strategy</th><th className="text-right">Trades</th><th className="text-right">Win %</th><th className="text-right">Net P&L</th></tr>
                </thead>
                <tbody>
                  {strat.map((s: any, i: number) => (
                    <tr key={i} className="border-t border-slate-800/60">
                      <td className="py-2 font-bold text-white">{s.strategy}</td>
                      <td className="text-right font-mono text-slate-300">{s.trades}</td>
                      <td className="text-right font-mono text-emerald-400">{((s.win_rate ?? 0) * 100).toFixed(0)}%</td>
                      <td className={`text-right font-mono font-bold ${signColor(s.net_pnl)}`}>{inr(s.net_pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={strat} dataKey="trades" nameKey="strategy" outerRadius={80}>
                    {strat.map((_: any, i: number) => <Cell key={i} fill={colors[i % colors.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ label, value, tone }: any) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="text-[10px] uppercase font-bold tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-black font-mono tracking-tight ${tone === "pos" ? "text-emerald-400" : tone === "neg" ? "text-rose-400" : "text-slate-100"}`}>{value ?? "—"}</div>
    </div>
  );
}
