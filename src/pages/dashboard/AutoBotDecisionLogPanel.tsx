import type { BotDecisionLog } from "../../stores/autoBot/types";

type AutoBotDecisionLogPanelProps = {
  entries: BotDecisionLog[];
  onClear: () => void;
};

export function AutoBotDecisionLogPanel({ entries, onClear }: AutoBotDecisionLogPanelProps) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs font-bold text-slate-300">Bot Decision Log</div>
        <button
          type="button"
          onClick={onClear}
          disabled={!entries.length}
          className="rounded border border-slate-700 px-2 py-1 text-[10px] font-bold text-slate-400 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear
        </button>
      </div>

      <div className="space-y-2">
        {entries.length === 0 && (
          <div className="py-4 text-center text-xs text-slate-500">No bot decisions recorded yet.</div>
        )}
        {entries.slice(0, 8).map((entry) => {
          const statusClass =
            entry.status === "TRADE" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" :
            entry.status === "BLOCKED" ? "border-amber-500/20 bg-amber-500/10 text-amber-300" :
            entry.status === "ERROR" ? "border-rose-500/20 bg-rose-500/10 text-rose-300" :
            entry.status === "SKIP" ? "border-slate-700 bg-slate-800/60 text-slate-300" :
            "border-indigo-500/20 bg-indigo-500/10 text-indigo-300";
          const detailPairs = Object.entries(entry.details || {}).slice(0, 5);

          return (
            <div key={entry.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${statusClass}`}>{entry.status}</span>
                <span className="font-mono text-[10px] text-slate-500">
                  {new Date(entry.time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}
                </span>
              </div>
              <div className="mt-1 text-slate-300">{entry.message}</div>
              {(entry.symbol || entry.confidence || entry.strategy) && (
                <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-slate-500">
                  {entry.symbol && <span>{entry.symbol}</span>}
                  {entry.side && <span>{entry.side}</span>}
                  {entry.confidence !== undefined && <span>{Math.round(entry.confidence)}%</span>}
                  {entry.strategy && <span>{entry.strategy}</span>}
                </div>
              )}
              {detailPairs.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-slate-500">
                  {detailPairs.map(([key, value]) => (
                    <span key={key} className="rounded border border-slate-800 bg-slate-900/80 px-1.5 py-0.5">
                      {key}: {String(value)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
