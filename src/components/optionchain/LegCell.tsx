import { inr, num } from "../../lib/utils";

type ColumnDef = {
  key: string;
  render: (r: any) => string;
};

const PE_COLUMNS: ColumnDef[] = [
  { key: "bid", render: (r) => inr(r.bid ?? 0) },
  { key: "ask", render: (r) => inr(r.ask ?? 0) },
  { key: "ltp", render: (r) => inr(r.ltp ?? 0) },
  { key: "iv", render: (r) => Number.isFinite(r.iv) ? `${r.iv.toFixed(1)}%` : "Unavailable" },
  { key: "volume", render: (r) => num(r.volume ?? 0, 0) },
  { key: "oi_change", render: (r) => num(r.oi_change ?? 0, 0) },
  { key: "oi", render: (r) => num(r.oi ?? 0, 0) },
];

const CE_COLUMNS: ColumnDef[] = [
  { key: "oi", render: (r) => num(r.oi ?? 0, 0) },
  { key: "oi_change", render: (r) => num(r.oi_change ?? 0, 0) },
  { key: "volume", render: (r) => num(r.volume ?? 0, 0) },
  { key: "iv", render: (r) => Number.isFinite(r.iv) ? `${r.iv.toFixed(1)}%` : "Unavailable" },
  { key: "ltp", render: (r) => inr(r.ltp ?? 0) },
  { key: "ask", render: (r) => inr(r.ask ?? 0) },
  { key: "bid", render: (r) => inr(r.bid ?? 0) },
];

type LegCellProps = {
  r: any;
  side: "CE" | "PE";
  isItm: boolean;
};

export function LegCell({ r, side, isItm }: LegCellProps) {
  const columns = side === "PE" ? PE_COLUMNS : CE_COLUMNS;
  if (!r) {
    return (
      <>
        {columns.map((col) => (
          <div key={col.key} className="w-full px-2 py-1.5 text-left font-mono text-slate-600">
            -
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      {columns.map((col) => {
        const value = col.render(r);
        let cellClasses = "w-full px-2 py-1.5 text-left font-mono transition-colors duration-150 select-none ";

        // Modern colorful styling based on ITM status and column type
        if (isItm) {
          cellClasses += "bg-indigo-950/30 ";
          if (col.key === "ltp") cellClasses += "text-indigo-300 font-bold ";
          else if (col.key === "oi" || col.key === "volume") cellClasses += "text-indigo-200 ";
          else cellClasses += "text-indigo-100/80 ";
        } else {
          if (col.key === "ltp") cellClasses += "text-emerald-300 font-bold ";
          else if (col.key === "oi" || col.key === "volume") cellClasses += "text-slate-200 ";
          else cellClasses += "text-slate-300 ";
        }

        // Highlight OI Change directionally
        if (col.key === "oi_change") {
          const chg = r.oi_change ?? 0;
          if (chg > 0) cellClasses += "text-rose-300 ";
          else if (chg < 0) cellClasses += "text-emerald-300 ";
        }

        return (
          <div
            key={col.key}
            className={cellClasses}
          >
            {value}
          </div>
        );
      })}
    </>
  );
}

