import { MARKET_REGIME_DISPLAY } from "../../lib/marketRegime";
import { inr } from "../../lib/utils";
import type { GuardEffectivenessSummary } from "../../lib/dryRunSimulator";
import { regimeToneClass, SummaryStat } from "./OrdersAutomationPrimitives";
import type { SessionSummary } from "./ordersAutomationModel";

type RegimeGuardEffectivenessPanelProps = {
  breakdown: SessionSummary["regimeGuardBreakdown"];
  effectiveness: GuardEffectivenessSummary;
};

export function RegimeGuardEffectivenessPanel({ breakdown, effectiveness }: RegimeGuardEffectivenessPanelProps) {
  if (!breakdown.length) return null;

  return (
    <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs">
      <div className="text-[10px] uppercase text-slate-500">Regime Guard Breakdown</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {breakdown.map((row) => {
          const display = MARKET_REGIME_DISPLAY[row.regime];
          return (
            <span key={row.regime} className={`rounded border px-2 py-1 text-[10px] font-bold ${regimeToneClass(display.tone)}`}>
              {display.label}: {row.count}
            </span>
          );
        })}
      </div>

      {effectiveness.rows.length > 0 && (
        <>
          <div className="mt-3 text-[10px] uppercase text-slate-500">Guard Effectiveness</div>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SummaryStat label="Saved SL" value={effectiveness.savedLosses} tone={effectiveness.savedLosses ? "emerald" : "slate"} />
            <SummaryStat label="Missed Wins" value={effectiveness.missedWins} tone={effectiveness.missedWins ? "rose" : "slate"} />
            <SummaryStat
              label="Avoided P&L"
              value={inr(effectiveness.netAvoidedPnl)}
              tone={effectiveness.netAvoidedPnl >= 0 ? "emerald" : "rose"}
            />
            <SummaryStat label="Open / Incomplete" value={`${effectiveness.open}/${effectiveness.incomplete}`} tone="amber" />
          </div>
          <div className="mt-2 text-[10px] text-slate-500">
            Positive avoided P&L means the guard blocked setups that later simulated as losing trades.
          </div>
        </>
      )}
    </div>
  );
}
