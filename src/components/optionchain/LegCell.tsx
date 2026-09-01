import { useNavigate } from "react-router-dom";
import { useTicket } from "../../stores";
import { inr, num } from "../../lib/utils";

type ColumnDef = {
  key: string;
  render: (r: any) => string;
  clickable?: boolean;
};

const PE_COLUMNS: ColumnDef[] = [
  { key: "bid", render: (r) => inr(r.bid ?? 0), clickable: true },
  { key: "ask", render: (r) => inr(r.ask ?? 0) },
  { key: "ltp", render: (r) => inr(r.ltp ?? 0), clickable: true },
  { key: "iv", render: (r) => r.iv ? `${r.iv.toFixed(1)}%` : "-" },
  { key: "volume", render: (r) => num(r.volume ?? 0, 0) },
  { key: "oi_change", render: (r) => num(r.oi_change ?? 0, 0) },
  { key: "oi", render: (r) => num(r.oi ?? 0, 0) },
];

const CE_COLUMNS: ColumnDef[] = [
  { key: "oi", render: (r) => num(r.oi ?? 0, 0) },
  { key: "oi_change", render: (r) => num(r.oi_change ?? 0, 0) },
  { key: "volume", render: (r) => num(r.volume ?? 0, 0) },
  { key: "iv", render: (r) => r.iv ? `${r.iv.toFixed(1)}%` : "-" },
  { key: "ltp", render: (r) => inr(r.ltp ?? 0), clickable: true },
  { key: "ask", render: (r) => inr(r.ask ?? 0) },
  { key: "bid", render: (r) => inr(r.bid ?? 0), clickable: true },
];

type LegCellProps = {
  r: any;
  lotSize: number;
  side: "CE" | "PE";
  isItm: boolean;
  symbol: string;
};

export function LegCell({ r, lotSize, side, isItm, symbol }: LegCellProps) {
  const columns = side === "PE" ? PE_COLUMNS : CE_COLUMNS;
  const openTicket = useTicket((s) => s.openFor);
  const navigate = useNavigate();

  const handleCellClick = () => {
    if (!r) return;

    // Navigate to paper trading page
    navigate("/paper");

    // Pre-fill the trade ticket
    openTicket({
      symbol: symbol || "",
      side: "BUY",
      qty: lotSize,
      orderType: "LIMIT",
      price: r.ltp || r.ask || r.bid || 0,
      lotSize,
      optionType: side,
      mode: "paper",
    });
  };

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
        const isClickable = col.clickable && (r.ltp || r.bid || r.ask);

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

        // Hover effects for clickable cells
        if (isClickable) {
          cellClasses += "cursor-pointer hover:bg-indigo-500/20 hover:text-indigo-100 rounded-md";
        }
        return (
          <div
            key={col.key}
            className={cellClasses}
            title={isClickable ? `Place ${side} Trade` : ""}
            onClick={() => isClickable && handleCellClick()}
          >
            {value}
          </div>
        );
      })}
    </>
  );
}

