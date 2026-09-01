import { Filter, RefreshCw } from "lucide-react";
import { OPTION_INDEXES } from "../../lib/optionChainModel";

type OptionFiltersProps = {
  index: string;
  expiries: any[];
  expiry: string | undefined;
  radius: number;
  minOI: number;
  onIndexChange: (value: string) => void;
  onExpiryChange: (value: string | undefined) => void;
  onRadiusChange: (value: number) => void;
  onMinOIChange: (value: number) => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
};

export function OptionFilters({
  index,
  expiries,
  expiry,
  radius,
  minOI,
  onIndexChange,
  onExpiryChange,
  onRadiusChange,
  onMinOIChange,
  onRefresh,
  isRefreshing = false,
}: OptionFiltersProps) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3">
      <select
        aria-label="Underlying index"
        value={index}
        onChange={(e) => onIndexChange(e.target.value)}
        className="rounded bg-slate-800 px-3 py-1.5 text-xs text-white outline-none"
      >
        {OPTION_INDEXES.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Option expiry"
        value={expiry ?? ""}
        onChange={(e) => onExpiryChange(e.target.value || undefined)}
        className="rounded bg-slate-800 px-3 py-1.5 text-xs text-white outline-none"
      >
        <option value="">All expiries</option>
        {(Array.isArray(expiries) ? expiries : []).map((e: any) => (
          <option key={e.expiry} value={e.expiry}>
            {e.date}
          </option>
        ))}
      </select>
      <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <Filter className="h-3.5 w-3.5" />
        <label>ATM +/-</label>
        <input
          type="number"
          min={0}
          max={5000}
          step={50}
          value={radius}
          onChange={(e) => onRadiusChange(Math.min(5000, Math.max(0, Number(e.target.value) || 0)))}
          className="w-16 rounded bg-slate-800 px-2 py-1 text-white outline-none"
        />
        <label>Min OI</label>
        <input
          type="number"
          min={0}
          max={1000000000}
          step={1000}
          value={minOI}
          onChange={(e) => onMinOIChange(Math.min(1000000000, Math.max(0, Number(e.target.value) || 0)))}
          className="w-24 rounded bg-slate-800 px-2 py-1 text-white outline-none"
        />
        <button type="button" onClick={onRefresh} disabled={isRefreshing} aria-label="Refresh option chain" title="Refresh option chain" className="rounded bg-slate-800 p-1.5 text-white hover:bg-slate-700 disabled:cursor-wait disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
        </button>
      </div>
    </div>
  );
}
