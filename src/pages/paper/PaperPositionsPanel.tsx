import { Power } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import ExitQuantitySelector from "../../components/ExitQuantitySelector";
import { buildQtyOptions, splitPaperPositions } from "../../lib/paperWalletModel";
import { getLotSizeFromSymbol, inr, signColor } from "../../lib/utils";

type PaperPositionsPanelProps = {
  positions: any[];
  exitLotsMap: Record<string, number>;
  setExitLotsMap: Dispatch<SetStateAction<Record<string, number>>>;
  exitMutation: any;
  marketOpen: boolean;
  onNewTrade: () => void;
};

export function PaperPositionsPanel({
  positions,
  exitLotsMap,
  setExitLotsMap,
  exitMutation,
  marketOpen,
  onNewTrade,
}: PaperPositionsPanelProps) {
  const { equityPositions, derivativePositions } = splitPaperPositions(positions);

  function exitPosition(symbol: string, qty: number, failurePrefix: string) {
    exitMutation.mutate(
      { orderId: symbol, qty },
      {
        onError: (err: any) => {
          alert(`${failurePrefix}: ${err?.message || "Unknown error"}`);
        },
      }
    );
  }

  function renderRows(items: any[], isDerivative: boolean) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-950/80">
        <div className="border-b border-slate-800 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          {isDerivative ? "F&O / Derivative Positions" : "Equity / Cash Positions"}
        </div>
        <table className="w-full text-xs">
          <thead className="bg-slate-900 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Symbol</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Avg</th>
              <th className="text-right">P&L</th>
              <th className="text-right">Exit</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => {
              const key = p.symbol;
              const totalQty = Math.abs(p.qty ?? p.openQty ?? 0);
              const lotSize = getLotSizeFromSymbol(p.symbol);
              const totalLots = isDerivative ? Math.max(1, Math.floor(totalQty / lotSize)) : 0;
              const currentValue = exitLotsMap[key] ?? (isDerivative ? totalLots : totalQty);
              const setCurrentValue = (v: number) => setExitLotsMap((prev) => ({ ...prev, [key]: v }));
              const options = isDerivative ? Array.from({ length: totalLots }, (_, i) => i + 1) : buildQtyOptions(totalQty);
              const qtyToExit = isDerivative ? Math.min(currentValue * lotSize, totalQty) : Math.min(currentValue, totalQty);
              const unit = isDerivative ? "lot" : "qty";
              const labelValue = isDerivative ? `${totalLots} lot${totalLots === 1 ? "" : "s"}` : totalQty;

              return (
                <tr key={key} className="border-t border-slate-800/60 hover:bg-slate-800/30">
                  <td className="px-3 py-2 font-bold text-white">{p.symbol}</td>
                  <td className="text-right font-mono font-bold text-slate-300">{labelValue}</td>
                  <td className="text-right font-mono text-slate-300">{inr(p.avgPrice)}</td>
                  <td className={`text-right font-mono font-bold ${signColor(p.unrealized ?? 0)}`}>{inr(p.unrealized)}</td>
                  <td className="text-right flex items-center gap-1 justify-end">
                    <ExitQuantitySelector options={options} value={currentValue} unit={unit} onChange={setCurrentValue} />
                    <button
                      onClick={() => {
                        if (qtyToExit <= 0) {
                          alert(`Cannot exit zero ${unit}.`);
                          return;
                        }
                        exitPosition(key, qtyToExit, "Exit failed");
                      }}
                      disabled={exitMutation.isPending || qtyToExit <= 0}
                      className="text-rose-400 hover:text-rose-300 disabled:opacity-50"
                      aria-label={`Exit ${currentValue} ${unit}${currentValue === 1 ? "" : "s"} of ${p.symbol}`}
                      title={`Exit ${currentValue} ${unit}${currentValue === 1 ? "" : "s"} of position`}
                    >
                      <Power className="inline h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => exitPosition(key, totalQty, "Full exit failed")}
                      disabled={exitMutation.isPending || totalQty <= 0}
                      className="rounded bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                      aria-label={`Exit full position for ${p.symbol}`}
                      title="Exit full position"
                    >
                      Full
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800">
      <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Open Paper Positions</h3>
          <div className="mt-1 text-[11px] text-slate-500">Equity positions are shown as quantity; F&O and derivative positions are shown as lots.</div>
        </div>
        <button
          onClick={() => {
            if (!marketOpen) {
              alert("Market Closed");
              return;
            }
            onNewTrade();
          }}
          className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-bold hover:bg-indigo-500"
          aria-label="Open new paper trade ticket"
          title="Create a new paper trade"
        >
          + New Trade
        </button>
      </div>

      {positions.length === 0 ? (
        <div className="p-6 text-center text-slate-500">No open positions.</div>
      ) : (
        <div className="space-y-4 p-4">
          {equityPositions.length > 0 && renderRows(equityPositions, false)}
          {derivativePositions.length > 0 && renderRows(derivativePositions, true)}
          {equityPositions.length === 0 && derivativePositions.length === 0 && (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-6 text-center text-slate-500">
              No open positions.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
