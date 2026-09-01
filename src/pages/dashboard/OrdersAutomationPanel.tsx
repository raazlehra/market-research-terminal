import { Link } from "react-router-dom";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart2 } from "lucide-react";
import { api } from "../../lib/api";
import { candlesFromHistoryPayload } from "../../lib/candlestickPatterns";
import {
  dryRunSimulationToOutcome,
  extractDryRunSetups,
  extractRegimeGuardSetups,
  persistDryRunSimulatedOutcomes,
  readDryRunSimulatedOutcomes,
  simulateDryRun,
  summarizeDryRunSimulations,
  summarizeGuardEffectiveness,
} from "../../lib/dryRunSimulator";
import { MARKET_REGIME_DISPLAY } from "../../lib/marketRegime";
import { patternAdjustmentFromRow, patternGuardrailFromOutcomes } from "../../lib/patternConfidence";
import { summarizePatternLearningAudit } from "../../lib/patternLearningAudit";
import { summarizePatternOutcomes } from "../../lib/patternOutcomeTracker";
import { useAutoBot } from "../../stores";
import { AutoBotControlsPanel } from "./AutoBotControlsPanel";
import { AutoBotDecisionLogPanel } from "./AutoBotDecisionLogPanel";
import { AutoBotSafetyPanel } from "./AutoBotSafetyPanel";
import { inr, signColor } from "../../lib/utils";
import { evidenceClass, regimeToneClass, simulationStatusClass, SummaryStat } from "./OrdersAutomationPrimitives";
import { RegimeGuardEffectivenessPanel } from "./RegimeGuardEffectivenessPanel";
import { latestMarketRegime, summarizeBotPerformance, summarizeBotSession } from "./ordersAutomationModel";

type OrdersAutomationPanelProps = {
  orders: any[];
  paperOutcomes: any[];
};

export function OrdersAutomationPanel({ orders, paperOutcomes }: OrdersAutomationPanelProps) {
  const bot = useAutoBot();
  const session = summarizeBotSession(bot.decisionLog);
  const performance = summarizeBotPerformance(paperOutcomes, bot.decisionLog);
  const dryRunSetups = extractDryRunSetups(bot.decisionLog, bot.timeframe);
  const regimeGuardSetups = extractRegimeGuardSetups(bot.decisionLog, bot.timeframe);
  const simulationSetups = [...dryRunSetups, ...regimeGuardSetups];
  const dryRunHistoryKey = simulationSetups.map((setup) => `${setup.symbol}|${setup.timeframe}`).sort().join(",");
  const dryRunHistory = useQuery({
    queryKey: ["dry-run-simulation-history", dryRunHistoryKey],
    enabled: simulationSetups.length > 0,
    staleTime: 30000,
    refetchInterval: 60000,
    queryFn: async () => {
      const unique = [...new Set(simulationSetups.map((setup) => `${setup.symbol}|${setup.timeframe}`))];
      const pairs = await Promise.all(unique.map(async (key) => {
        const [symbol, timeframe] = key.split("|");
        try {
          const history = await api.history(symbol, timeframe || "5", timeframe === "60" ? 30 : 7);
          return [key, candlesFromHistoryPayload(history)] as const;
        } catch {
          return [key, []] as const;
        }
      }));
      return Object.fromEntries(pairs);
    },
  });
  const dryRunSimulations = dryRunSetups.map((setup) =>
    simulateDryRun(setup, dryRunHistory.data?.[`${setup.symbol}|${setup.timeframe}`] || [])
  );
  const regimeGuardSimulations = regimeGuardSetups.map((setup) =>
    simulateDryRun(setup, dryRunHistory.data?.[`${setup.symbol}|${setup.timeframe}`] || [])
  );
  const dryRunSimulationSummary = summarizeDryRunSimulations(dryRunSimulations);
  const regimeGuardEffectiveness = summarizeGuardEffectiveness(regimeGuardSimulations);
  const dryRunSimulationPersistKey = dryRunSimulations.map((row) => `${row.id}:${row.status}:${row.pnl}`).join(",");
  const simulatedOutcomeMap = new Map<string, Record<string, unknown>>();
  for (const outcome of readDryRunSimulatedOutcomes()) {
    simulatedOutcomeMap.set(String(outcome.orderId || outcome.id || ""), outcome);
  }
  for (const outcome of dryRunSimulations.map(dryRunSimulationToOutcome).filter((row): row is Record<string, unknown> => Boolean(row))) {
    simulatedOutcomeMap.set(String(outcome.orderId || outcome.id || ""), outcome);
  }
  const learningOutcomes = [...paperOutcomes, ...simulatedOutcomeMap.values()];
  const patternSummary = summarizePatternOutcomes(learningOutcomes, bot.decisionLog);
  const regimePatternSummary = summarizePatternOutcomes(learningOutcomes, bot.decisionLog, { keyByRegime: true });
  const learningAudit = summarizePatternLearningAudit(regimePatternSummary, learningOutcomes, bot.maxPatternConfidenceAdjustment);
  const currentRegime = latestMarketRegime(bot.decisionLog);
  const currentRegimeDisplay = currentRegime ? MARKET_REGIME_DISPLAY[currentRegime.regime] : null;

  useEffect(() => {
    if (!dryRunHistory.data) return;
    persistDryRunSimulatedOutcomes(dryRunSimulations);
  }, [dryRunHistory.data, dryRunSimulationPersistKey]);

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-indigo-400" />
          <h3 className="text-sm font-bold text-white">Orders & Automation</h3>
        </div>
        <Link to="/orders" className="text-xs text-indigo-400 hover:underline">Orders</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <div className="text-slate-500">Open orders</div>
          <div className="mt-2 text-lg font-black font-mono text-white">{orders.filter((o) => String(o.status || "").toUpperCase().includes("OPEN")).length}</div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
          <div className="text-slate-500">Bot fills</div>
          <div className="mt-2 text-lg font-black font-mono text-white">{bot.tradesExecuted}</div>
        </div>
        <div className="col-span-2 rounded-xl border border-slate-800 bg-slate-950/40 p-3 lg:col-span-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-slate-500">Current Regime</div>
            <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${currentRegimeDisplay ? regimeToneClass(currentRegimeDisplay.tone) : regimeToneClass("slate")}`}>
              {currentRegimeDisplay?.label || "Waiting"}
            </span>
          </div>
          <div className="mt-2 truncate text-xs font-bold text-slate-200">
            {currentRegime ? currentRegime.symbol : "No candle scan yet"}
          </div>
          <div className="mt-1 truncate text-[10px] text-slate-500">
            {currentRegime
              ? `Trend ${currentRegime.trendPct ?? "--"}% / Range ${currentRegime.rangePct ?? "--"}%`
              : "Runs after scanner or option watch checks candles"}
          </div>
        </div>
      </div>

      <AutoBotControlsPanel />

      <AutoBotSafetyPanel />

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs font-bold text-slate-300">Auto-Bot Session</div>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-300">
            {session.rows.length} today
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <SummaryStat label="Scan Logs" value={session.loggedScans} tone="indigo" />
          <SummaryStat label="Candidates" value={session.candidatesChecked || "--"} />
          <SummaryStat label="Dry Runs" value={session.dryRuns} tone="amber" />
          <SummaryStat label="Paper Trades" value={session.paperTrades} tone="emerald" />
          <SummaryStat label="Skipped" value={session.skipped} />
          <SummaryStat label="Blocked" value={session.blocked} tone={session.blocked ? "amber" : "slate"} />
          <SummaryStat label="Regime Guard" value={session.regimeGuardBlocks} tone={session.regimeGuardBlocks ? "amber" : "slate"} />
          <SummaryStat label="Errors" value={session.errors} tone={session.errors ? "rose" : "slate"} />
          <SummaryStat label="Best %" value={session.bestConfidence === null ? "--" : `${Math.round(session.bestConfidence)}%`} tone="emerald" />
        </div>

        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
            <div className="text-[10px] uppercase text-slate-500">Top Reject Reason</div>
            <div className="mt-1 truncate text-slate-300">{session.topReason}</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
            <div className="text-[10px] uppercase text-slate-500">Best Seen</div>
            <div className="mt-1 truncate text-slate-300">
              {session.bestSetup} <span className="text-slate-500">/ {session.bestIndex}</span>
            </div>
          </div>
        </div>
        <RegimeGuardEffectivenessPanel breakdown={session.regimeGuardBreakdown} effectiveness={regimeGuardEffectiveness} />
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs font-bold text-slate-300">Bot Performance</div>
          <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${performance.netPnl >= 0 ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
            PAPER REALIZED
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <SummaryStat label="Net P&L" value={inr(performance.netPnl)} tone={performance.netPnl >= 0 ? "emerald" : "rose"} />
          <SummaryStat label="Win Rate" value={performance.closed.length ? `${Math.round(performance.winRate * 100)}%` : "--"} tone="indigo" />
          <SummaryStat label="Wins / Losses" value={`${performance.wins}/${performance.losses}`} />
          <SummaryStat label="Avg R" value={performance.avgR === null ? "--" : `${performance.avgR.toFixed(2)}R`} tone={performance.avgR === null || performance.avgR >= 0 ? "emerald" : "rose"} />
          <SummaryStat label="Closed" value={performance.closed.length} />
          <SummaryStat label="Open" value={performance.open.length} />
          <SummaryStat label="T1 / T2" value={`${performance.t1Hits}/${performance.t2Hits}`} tone="emerald" />
          <SummaryStat label="SL Hits" value={performance.slHits} tone={performance.slHits ? "rose" : "slate"} />
        </div>

        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
            <div className="text-[10px] uppercase text-slate-500">Best Strategy P&L</div>
            <div className={`mt-1 truncate ${signColor(performance.netPnl)}`}>{performance.bestStrategy}</div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
            <div className="text-[10px] uppercase text-slate-500">Dry-Run Signals</div>
            <div className="mt-1 truncate text-slate-300">
              {performance.dryRunSignals} logged <span className="text-slate-500">/ {performance.dryRunReady} ready for outcome tracking</span>
            </div>
          </div>
        </div>

        <div className="mt-2 text-[10px] text-slate-500">
          Paper Auto is judged by actual paper P&L. Dry Run is simulated below from follow-up candles.
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs font-bold text-slate-300">Dry-Run Simulation</div>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-300">
            {dryRunHistory.isFetching ? "CHECKING" : `${dryRunSimulationSummary.rows.length} signals`}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <SummaryStat label="Net Sim P&L" value={inr(dryRunSimulationSummary.netPnl)} tone={dryRunSimulationSummary.netPnl >= 0 ? "emerald" : "rose"} />
          <SummaryStat label="Win Rate" value={dryRunSimulationSummary.complete.length ? `${Math.round(dryRunSimulationSummary.winRate * 100)}%` : "--"} tone="indigo" />
          <SummaryStat label="T1 / T2" value={`${dryRunSimulationSummary.t1Hits}/${dryRunSimulationSummary.t2Hits}`} tone="emerald" />
          <SummaryStat label="SL / Open" value={`${dryRunSimulationSummary.slHits}/${dryRunSimulationSummary.open.length}`} tone={dryRunSimulationSummary.slHits ? "rose" : "slate"} />
          <SummaryStat label="Avg R" value={dryRunSimulationSummary.avgR === null ? "--" : `${dryRunSimulationSummary.avgR.toFixed(2)}R`} tone={dryRunSimulationSummary.avgR === null || dryRunSimulationSummary.avgR >= 0 ? "emerald" : "rose"} />
          <SummaryStat label="Complete" value={dryRunSimulationSummary.complete.length} />
          <SummaryStat label="Ambiguous" value={dryRunSimulationSummary.ambiguous} tone={dryRunSimulationSummary.ambiguous ? "amber" : "slate"} />
          <SummaryStat label="Incomplete" value={dryRunSimulationSummary.incomplete.length} tone={dryRunSimulationSummary.incomplete.length ? "amber" : "slate"} />
        </div>

        <div className="mt-3 space-y-2 text-xs">
          {dryRunSimulationSummary.rows.length === 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-4 text-center text-slate-500">
              No dry-run signals with entry/SL/targets yet.
            </div>
          )}
          {dryRunSimulationSummary.rows.slice(0, 4).map((row) => (
            <div key={row.id} className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 sm:grid-cols-[1.5fr_0.7fr_0.8fr_0.8fr] sm:items-center">
              <div className="min-w-0">
                <div className="truncate font-bold text-slate-200">{row.symbol}</div>
                <div className="mt-0.5 truncate text-[10px] text-slate-500">
                  {row.pattern} / {row.strategy}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-slate-500">Status</div>
                <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${simulationStatusClass(row.status)}`}>
                  {row.status}
                </span>
              </div>
              <div>
                <div className="text-[10px] uppercase text-slate-500">P&L / R</div>
                <div className={`font-mono font-bold ${signColor(row.pnl)}`}>
                  {inr(row.pnl)} <span className="text-slate-500">{row.rMultiple === null ? "" : `${row.rMultiple.toFixed(2)}R`}</span>
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-slate-500">Entry / Exit</div>
                <div className="font-mono font-bold text-slate-200">
                  {row.entry.toFixed(2)} <span className="text-slate-500">/ {row.exitPrice === null ? "--" : row.exitPrice.toFixed(2)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs font-bold text-slate-300">Pattern Outcome Tracker</div>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-300">
            {patternSummary.rows.length} patterns
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <SummaryStat label="Tracked Trades" value={patternSummary.trackedTrades} tone="indigo" />
          <SummaryStat label="Blocked" value={patternSummary.blockedByPattern} tone={patternSummary.blockedByPattern ? "amber" : "slate"} />
          <SummaryStat
            label="Adaptive"
            value={bot.adaptivePatternConfidenceEnabled ? `+/-${bot.maxPatternConfidenceAdjustment}` : "OFF"}
            tone={bot.adaptivePatternConfidenceEnabled ? "indigo" : "slate"}
          />
          <SummaryStat
            label="Best Pattern"
            value={patternSummary.bestPattern?.pattern || "--"}
            tone={patternSummary.bestPattern ? "emerald" : "slate"}
          />
          <SummaryStat
            label="Best P&L"
            value={patternSummary.bestPattern ? inr(patternSummary.bestPattern.netPnl) : "--"}
            tone={!patternSummary.bestPattern || patternSummary.bestPattern.netPnl >= 0 ? "emerald" : "rose"}
          />
        </div>

        <div className="mt-3 space-y-2 text-xs">
          {patternSummary.rows.length === 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-4 text-center text-slate-500">
              No pattern outcomes yet. The next candle-confirmed dry run or paper order will start this table.
            </div>
          )}
          {patternSummary.rows.slice(0, 4).map((row) => {
            const winRate = row.closed ? `${Math.round((row.wins / row.closed) * 100)}%` : "--";
            const adjustment = patternAdjustmentFromRow(
              row,
              bot.maxPatternConfidenceAdjustment,
              patternGuardrailFromOutcomes(row.pattern, learningOutcomes)
            );
            return (
              <div key={row.pattern} className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 sm:grid-cols-[1.5fr_0.8fr_0.8fr_0.8fr] sm:items-center">
                <div className="min-w-0">
                  <div className="truncate font-bold text-slate-200">{row.pattern}</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">
                    seen {row.observed} / score {row.avgScore === null ? "--" : `${Math.round(row.avgScore)}%`} / adj {adjustment.adjustment > 0 ? "+" : ""}{adjustment.adjustment}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-500">Trades</div>
                  <div className="font-mono font-bold text-slate-200">{row.closed}/{row.trades}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-500">Win / R</div>
                  <div className="font-mono font-bold text-slate-200">
                    {winRate} <span className="text-slate-500">{row.avgR === null ? "" : `${row.avgR.toFixed(2)}R`}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-500">P&L / Hits</div>
                  <div className={`font-mono font-bold ${signColor(row.netPnl)}`}>
                    {inr(row.netPnl)} <span className="text-slate-500">T{row.t1Hits}/{row.t2Hits} SL{row.slHits}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-2 text-[10px] text-slate-500">
          Adaptive pattern confidence uses closed paper outcomes plus completed dry-run simulations.
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs font-bold text-slate-300">Pattern Learning Audit</div>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-300">
            {learningAudit.guarded ? `${learningAudit.guarded} guarded` : `${learningAudit.ready} ready`}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <SummaryStat label="Guarded" value={learningAudit.guarded} tone={learningAudit.guarded ? "rose" : "slate"} />
          <SummaryStat label="Ready" value={learningAudit.ready} tone="emerald" />
          <SummaryStat label="Building" value={learningAudit.building} tone={learningAudit.building ? "amber" : "slate"} />
          <SummaryStat label="Paper / Dry" value={`${learningAudit.paperClosed}/${learningAudit.dryRunClosed}`} tone="indigo" />
        </div>

        <div className="mt-3 space-y-2 text-xs">
          {learningAudit.rows.length === 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-4 text-center text-slate-500">
              No pattern learning evidence yet.
            </div>
          )}
          {learningAudit.rows.slice(0, 5).map((row) => {
            const adj = row.adjustment.adjustment;
            return (
              <div key={`${row.pattern}:${row.regime || "ALL"}`} className="grid gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 sm:grid-cols-[1.35fr_0.7fr_0.8fr_1fr] sm:items-center">
                <div className="min-w-0">
                  <div className="truncate font-bold text-slate-200">{row.pattern}</div>
                  <div className="mt-0.5 truncate text-[10px] text-slate-500">
                    {row.regime || "ALL_REGIMES"} / {row.adjustment.reason}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-500">Evidence</div>
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${evidenceClass(row.evidence)}`}>
                    {row.evidence}
                  </span>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-500">Adjust / Samples</div>
                  <div className={`font-mono font-bold ${adj > 0 ? "text-emerald-300" : adj < 0 ? "text-rose-300" : "text-slate-200"}`}>
                    {adj > 0 ? "+" : ""}{adj} <span className="text-slate-500">P{row.paperClosed}/D{row.dryRunClosed}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-500">Win / R / Last</div>
                  <div className="truncate font-mono font-bold text-slate-200">
                    {row.winRate === null ? "--" : `${Math.round(row.winRate * 100)}%`}{" "}
                    <span className="text-slate-500">{row.avgR === null ? "--" : `${row.avgR.toFixed(2)}R`} / {row.lastOutcome}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
        <div className="mb-1 font-bold text-slate-300">Last bot action</div>
        <div>{bot.lastAction || "No automated action yet."}</div>
      </div>

      <AutoBotDecisionLogPanel entries={bot.decisionLog} onClear={bot.clearDecisionLog} />
    </div>
  );
}
