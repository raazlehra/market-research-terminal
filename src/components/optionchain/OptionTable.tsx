import { LegCell } from "./LegCell";
import type { ConfidenceResult } from "../../lib/optionChainConfidence";

// Keep all market values readable; narrow screens scroll rather than compressing 15 columns.
const GRID_TEMPLATE = "8fr 8fr 9fr 6fr 13fr 13fr 13fr 9fr 13fr 13fr 13fr 6fr 9fr 8fr 8fr";

type OptionTableProps = {
  rows: any[];
  effectiveAtm: number | null;
  radius: number;
  minOI: number;
  selectedRow: any | null;
  setSelectedRow: (row: any) => void;
  confidenceMap: Record<string, ConfidenceResult>;
  marketStructureOverall: string;
};

export function OptionTable({
  rows,
  effectiveAtm,
  radius,
  minOI,
  selectedRow,
  setSelectedRow,
}: OptionTableProps) {
  const filteredRows = rows.filter((row) => {
    if (minOI && (row.ce?.oi ?? 0) < minOI && (row.pe?.oi ?? 0) < minOI) {
      return false;
    }
    if (!effectiveAtm) return true;
    return Math.abs(row.strike - effectiveAtm) <= radius;
  });

  return (
    <div className="flex flex-col rounded-2xl border border-slate-700/50 bg-slate-900/80 backdrop-blur-md shadow-2xl overflow-hidden">
      <div className="w-full overflow-x-auto">
        <div className="min-w-[1180px]">
        {/* Header Rows */}
        <div className="sticky top-0 z-20 border-b border-slate-700/80 bg-slate-800/95 shadow-md backdrop-blur-md">
          <div
            className="grid border-b border-slate-700/60 py-2 text-[10px] font-black uppercase tracking-[0.18em]"
            style={{ gridTemplateColumns: GRID_TEMPLATE }}
          >
            <div className="text-center text-rose-300" style={{ gridColumn: "1 / span 7" }}>
              Puts / PE
            </div>
            <div className="text-center text-indigo-300" style={{ gridColumn: "8 / span 1" }}>
              Strike
            </div>
            <div className="text-center text-emerald-300" style={{ gridColumn: "9 / span 7" }}>
              Calls / CE
            </div>
          </div>
          <div
            className="grid py-3 text-[10px] font-black uppercase tracking-[0.2em]"
            style={{ gridTemplateColumns: GRID_TEMPLATE }}
          >
            <div className="text-center text-rose-400">PE Bid</div>
            <div className="text-center text-cyan-400">PE Ask</div>
            <div className="text-center text-emerald-400">PE LTP</div>
            <div className="text-center text-violet-400">PE IV</div>
            <div className="text-center text-slate-300">PE Vol</div>
            <div className="text-center text-slate-300">PE Chg OI</div>
            <div className="text-center text-slate-300">PE OI</div>

            <div className="text-center font-black text-indigo-400 border-x border-slate-600/50 bg-slate-800/95">
              Strike
            </div>

            <div className="text-center text-slate-300">CE OI</div>
            <div className="text-center text-slate-300">CE Chg OI</div>
            <div className="text-center text-slate-300">CE Vol</div>
            <div className="text-center text-violet-400">CE IV</div>
            <div className="text-center text-emerald-400">CE LTP</div>
            <div className="text-center text-cyan-400">CE Ask</div>
            <div className="text-center text-rose-400">CE Bid</div>
          </div>
        </div>
        {/* Data Rows */}
        <div className="divide-y divide-slate-800/50">
          {filteredRows.length === 0 && (
            <div className="px-4 py-8 text-center text-xs text-slate-400">
              No option-chain rows returned for the selected index and expiry.
            </div>
          )}
          {filteredRows.map((row) => {
            const isSelected = selectedRow?.strike === row.strike;
            const isAtm = effectiveAtm !== null && row.strike === effectiveAtm;

            return (
              <div
                key={row.strike}
                className={`grid text-xs transition-all duration-200 ease-in-out ${
                  isSelected
                    ? "bg-indigo-950/60 ring-2 ring-inset ring-indigo-500/60"
                    : isAtm
                      ? "bg-amber-500/10 hover:bg-amber-500/15"
                      : "hover:bg-slate-800/60"
                }`}
                style={{ gridTemplateColumns: GRID_TEMPLATE }}
                onClick={() => setSelectedRow(row)}
              >
                {/* PE LegCells (7 columns) */}
                <LegCell
                  r={row.pe}
                  side="PE"
                  isItm={row.pe?.itm ?? false}
                />

                {/* Strike (1 column, no duplicate) */}
                <div className={`flex items-center justify-center border-x border-slate-700/30 font-black tracking-wider ${
                  isAtm ? "text-amber-300" : "text-slate-200"
                }`}>
                  {row.strike}
                </div>

                {/* CE LegCells (7 columns) */}
                <LegCell
                  r={row.ce}
                  side="CE"
                  isItm={row.ce?.itm ?? false}
                />
              </div>
            );
          })}
        </div>
        </div>
      </div>
    </div>
  );
}

