import { useState } from "react";
import { BookOpen, Plus, Tag, Calendar, Trash2 } from "lucide-react";
import { fmtTime } from "../lib/utils";

interface Log {
  id: string;
  time: string;
  symbol: string;
  strategy: string;
  pnl: number;
  notes: string;
}

export default function Journal() {
  const [logs, setLogs] = useState<Log[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("fyers_v3_journal") || "[]");
    } catch { return []; }
  });

  const [symbol, setSymbol] = useState("");
  const [strategy, setStrategy] = useState("Breakdown Momentum");
  const [pnl, setPnl] = useState("");
  const [notes, setNotes] = useState("");

  function addLog() {
    if (!symbol || !notes) return;
    const newLog: Log = {
      id: "J-" + Date.now(),
      time: new Date().toISOString(),
      symbol: symbol.toUpperCase(),
      strategy,
      pnl: parseFloat(pnl) || 0,
      notes
    };
    const next = [newLog, ...logs];
    setLogs(next);
    localStorage.setItem("fyers_v3_journal", JSON.stringify(next));
    setSymbol("");
    setPnl("");
    setNotes("");
  }

  function removeLog(id: string) {
    const next = logs.filter(l => l.id !== id);
    setLogs(next);
    localStorage.setItem("fyers_v3_journal", JSON.stringify(next));
  }

  return (
    <div className="p-5 max-w-5xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-indigo-400" /> Trading Journal
          </h1>
          <p className="text-sm text-slate-500">Document intraday mindset, tag strategy edges, and store retrospective lessons.</p>
        </div>
      </div>

      {/* Input Box */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3">
        <div className="text-xs font-bold text-slate-300">New Trade Log Entry</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="Symbol (e.g. NIFTY)"
            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none"
          />
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none"
          >
            <option>Breakdown Momentum</option>
            <option>Pullback Buy</option>
            <option>Gap Up Sustain</option>
            <option>Golden Crossover</option>
            <option>Inside Bar Breakout</option>
            <option>Volume Climax</option>
            <option>VWAP Bounce</option>
          </select>
          <input
            type="number"
            value={pnl}
            onChange={(e) => setPnl(e.target.value)}
            placeholder="P&L Result (₹)"
            className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none"
          />
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What confluence triggers did you map? How was the price action vs Open Interest?"
          rows={3}
          className="w-full rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-white outline-none"
        />
        <button
          onClick={addLog}
          className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white hover:bg-indigo-500"
        >
          <Plus className="h-4 w-4" /> Save Journal Entry
        </button>
      </div>

      {/* Entries List */}
      <div className="space-y-3">
        {logs.length === 0 && (
          <div className="rounded-xl border border-slate-800/40 p-12 text-center text-slate-500 text-xs">
            No logs saved. Start journaling your edge to track performance.
          </div>
        )}
        {logs.map((l) => (
          <div key={l.id} className="rounded-xl border border-slate-800/80 bg-slate-900/20 p-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-white">{l.symbol}</span>
                <span className="flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                  <Tag className="h-2.5 w-2.5 text-indigo-400" /> {l.strategy}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className={`font-mono font-bold text-xs ${l.pnl > 0 ? "text-emerald-400" : l.pnl < 0 ? "text-rose-400" : "text-slate-400"}`}>
                  {l.pnl > 0 ? `+₹${l.pnl}` : `₹${l.pnl}`}
                </span>
                <span className="flex items-center gap-1 text-slate-500 text-[10px]">
                  <Calendar className="h-3 w-3" /> {fmtTime(l.time)}
                </span>
                <button onClick={() => removeLog(l.id)} className="text-slate-600 hover:text-rose-400">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-300 whitespace-pre-wrap pl-1 leading-relaxed">
              {l.notes}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
