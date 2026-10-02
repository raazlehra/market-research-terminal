import { useEffect, useState } from "react";
import { useWatchlist, useMarket } from "../stores";
import { socket } from "../lib/api";
import { inr, pct, signColor } from "../lib/utils";
import { Plus, X } from "lucide-react";

const PRESET_SYMBOLS = [
  "NSE:NIFTY50-INDEX", "NSE:NIFTYBANK-INDEX", "NSE:FINNIFTY-INDEX", "NSE:MIDCPNIFTY-INDEX",
  "NSE:SBIN-EQ", "NSE:RELIANCE-EQ", "NSE:TCS-EQ", "NSE:HDFCBANK-EQ", "NSE:ICICIBANK-EQ",
  "NSE:INFY-EQ", "NSE:AXISBANK-EQ", "NSE:TATAMOTORS-EQ", "NSE:ITC-EQ", "NSE:LT-EQ",
];

export default function Watchlist() {
  const { symbols, add, remove } = useWatchlist();
  const [input, setInput] = useState("");
  const ticks = useMarket((s) => s.ticks);

  useEffect(() => {
    socket.subscribe(symbols);
    return () => socket.unsubscribe(symbols);
  }, [symbols]);

  return (
    <div className="p-5 animate-in fade-in duration-200">
      <div className="mb-4">
        <h1 className="text-xl font-bold">Watchlist</h1>
        <p className="text-sm text-slate-500">{symbols.length} symbols • streaming via WebSocket</p>
      </div>

      <div className="mb-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="NSE:SBIN-EQ, NSE:NIFTY24OCT24000CE"
          className="flex-1 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
        />
        <button onClick={() => { if (input.trim()) { add(input.trim()); setInput(""); } }} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500">
          <Plus className="mr-1 inline h-3.5 w-3.5" />Add
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {PRESET_SYMBOLS.filter((s) => !symbols.includes(s)).slice(0, 12).map((s) => (
          <button key={s} onClick={() => add(s)} className="rounded bg-slate-900 border border-slate-800 px-2.5 py-1 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-white">
            + {s.replace("NSE:", "").replace("BSE:", "")}
          </button>
        ))}
      </div>

      <div className="overflow-auto rounded-lg border border-slate-800">
        <table className="w-full text-xs">
          <thead className="bg-slate-900 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Symbol</th>
              <th className="text-right">LTP</th>
              <th className="text-right">Change</th>
              <th className="text-right">%Chg</th>
              <th className="text-right">Bid</th>
              <th className="text-right">Ask</th>
              <th className="text-right">OI</th>
              <th className="text-right">Volume</th>
              <th className="text-right">Manage</th>
            </tr>
          </thead>
          <tbody>
            {symbols.length === 0 && <tr><td colSpan={9} className="py-8 text-center text-slate-500">No symbols in watchlist.</td></tr>}
            {symbols.map((s) => {
              const t = ticks[s];
              const chg = t?.ch ?? 0;
              const chp = t?.chp ?? 0;
              return (
                <tr key={s} className="border-t border-slate-800/60 hover:bg-slate-800/30 transition">
                  <td className="px-3 py-2 font-bold text-white">{s}</td>
                  <td className="text-right font-mono font-bold text-slate-100">{t ? inr(t.ltp) : <span className="text-slate-600">—</span>}</td>
                  <td className={`text-right font-mono ${signColor(chg)}`}>{t ? inr(chg) : "—"}</td>
                  <td className={`text-right font-mono ${signColor(chp)}`}>{t ? pct(chp) : "—"}</td>
                  <td className="text-right font-mono text-emerald-400">{t?.bid ? inr(t.bid) : "—"}</td>
                  <td className="text-right font-mono text-rose-400">{t?.ask ? inr(t.ask) : "—"}</td>
                  <td className="text-right font-mono text-slate-400">{t?.oi ?? "—"}</td>
                  <td className="text-right font-mono text-slate-400">{t?.volume ?? "—"}</td>
                  <td className="text-right">
                    <button onClick={() => remove(s)} title="Remove from watchlist" className="text-rose-400 hover:text-rose-300">
                      <X className="inline h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
