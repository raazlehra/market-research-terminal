import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { getActiveCooldowns, type ActiveCooldown } from "../../stores/autoBot/cooldown";
import { useAutoBot, useMarket, useSettings } from "../../stores";
import { inr } from "../../lib/utils";

function StatusRow({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
      <span className="text-slate-400">{label}</span>
      <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${ok ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
        {value}
      </span>
    </div>
  );
}

function compactQty(value: number) {
  if (!Number.isFinite(value)) return "--";
  if (value >= Number.MAX_SAFE_INTEGER / 2) return "No cap";
  return String(Math.max(0, Math.floor(value)));
}

export function AutoBotSafetyPanel() {
  const bot = useAutoBot();
  const settings = useSettings();
  const market = useMarket();
  const [cooldowns, setCooldowns] = useState<ActiveCooldown[]>(() => getActiveCooldowns());
  const tradesLeft = Math.max(bot.maxTradesPerDay - bot.tradesExecuted, 0);

  useEffect(() => {
    const refresh = () => setCooldowns(getActiveCooldowns());
    refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => window.clearInterval(timer);
  }, [bot.lastAction]);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          Auto-Bot Safety
        </div>
        <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${bot.enabled && !bot.paused ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>
          {bot.enabled ? (bot.paused ? "PAUSED" : "READY") : "OFF"}
        </span>
      </div>

      <div className="grid gap-2 text-xs sm:grid-cols-2">
        <StatusRow label="Market" ok={market.marketOpen} value={market.marketOpen ? "OPEN" : "CLOSED"} />
        <StatusRow label="Mode" ok={settings.tradingMode === "paper"} value={settings.tradingMode.toUpperCase()} />
        <StatusRow label="Execution" ok={bot.executionMode === "dry_run"} value={bot.executionMode === "dry_run" ? "DRY RUN" : "PAPER AUTO"} />
        <StatusRow label="Live Broker Orders" ok value="DISABLED" />
        <StatusRow
          label="Candles"
          ok={bot.candleConfirmationMode !== "off"}
          value={bot.candleConfirmationMode === "block_opposite" ? `BLOCK ${bot.minCandleScore}/100` : bot.candleConfirmationMode.toUpperCase()}
        />
        <StatusRow
          label="Pattern Learning"
          ok={bot.adaptivePatternConfidenceEnabled}
          value={bot.adaptivePatternConfidenceEnabled ? `+/-${bot.maxPatternConfidenceAdjustment}` : "OFF"}
        />
        <StatusRow
          label="Regime Guard"
          ok={bot.regimeGuardEnabled}
          value={bot.regimeGuardEnabled ? `${bot.regimeGuardMinCandleScore}/100` : "OFF"}
        />
        <StatusRow label="Kill Switch" ok={!settings.killSwitch} value={settings.killSwitch ? "ON" : "OFF"} />
        <StatusRow label="Scan Every" ok={bot.enabled && !bot.paused} value="15s" />
        <StatusRow label="Index Options" ok={bot.optionIndexWatchEnabled} value={bot.optionIndexWatchEnabled ? "45s" : "OFF"} />
        <StatusRow label="Trades Left" ok={tradesLeft > 0} value={`${tradesLeft}/${bot.maxTradesPerDay}`} />
        <StatusRow label="Auto Exits" ok={bot.autoExitEnabled} value={bot.autoExitEnabled ? "ON" : "OFF"} />
        <StatusRow label="Trail SL" ok={bot.trailingSlEnabled} value={bot.trailingSlEnabled ? "ON" : "OFF"} />
      </div>

      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-bold text-slate-300">Option Index Watch</span>
          <span className="rounded px-2 py-0.5 text-[10px] font-bold bg-slate-800 text-slate-300">
            {bot.optionWatchRows.length || 0}
          </span>
        </div>
        {bot.optionWatchRows.length === 0 ? (
          <div className="text-slate-500">No index comparison yet.</div>
        ) : (
          <div className="space-y-2">
            {bot.optionWatchRows.map((row) => (
              <div key={row.index} className="grid grid-cols-[92px_1fr_auto] items-center gap-2 rounded border border-slate-800/80 bg-slate-950/70 px-2 py-2">
                <div>
                  <div className="font-bold text-slate-200">{row.label}</div>
                  <div className="text-[10px] text-slate-500">{row.bias || "--"} {row.confluence ?? "--"}/100</div>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-slate-300">
                    {row.optionSide && row.strike ? `${row.optionSide} ${row.strike}` : "No setup"}
                  </div>
                  <div className="truncate text-[10px] text-slate-500">
                    L {row.liquidityScore ?? "--"} / E {row.expiryScore ?? "--"} / C {row.chartScore ?? "--"} - {row.reason || "--"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-slate-200">{Math.round(Number(row.finalScore || 0))}</div>
                  <div className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${row.status === "READY" ? "bg-emerald-500/15 text-emerald-300" : row.status === "ERROR" ? "bg-rose-500/15 text-rose-300" : "bg-amber-500/15 text-amber-300"}`}>
                    {row.status}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-bold text-slate-300">Last Option Sizing</span>
          <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${bot.lastOptionSizing?.blocked ? "bg-rose-500/15 text-rose-300" : "bg-slate-800 text-slate-300"}`}>
            {bot.lastOptionSizing ? `${bot.lastOptionSizing.finalLots} lot(s)` : "--"}
          </span>
        </div>
        {!bot.lastOptionSizing ? (
          <div className="text-slate-500">No option order sizing yet.</div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-slate-300">{bot.lastOptionSizing.symbol}</span>
              <span className="font-mono text-slate-200">
                {bot.lastOptionSizing.requestedLots} requested - {bot.lastOptionSizing.finalLots} final
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500">
              <span>{bot.lastOptionSizing.sizingMode}</span>
              <span>max {bot.lastOptionSizing.maxLots} lot(s)</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <StatusRow label="Entry / SL" ok value={`${inr(bot.lastOptionSizing.entry)} / ${inr(bot.lastOptionSizing.sl)}`} />
              <StatusRow label="Risk / Qty" ok value={inr(bot.lastOptionSizing.riskPerQty)} />
              <StatusRow label="Risk Budget" ok value={inr(bot.lastOptionSizing.riskBudget)} />
              <StatusRow label="By Risk" ok={bot.lastOptionSizing.maxQtyByRisk >= bot.lastOptionSizing.lotSize} value={compactQty(bot.lastOptionSizing.maxQtyByRisk)} />
              <StatusRow label="By Cash" ok={bot.lastOptionSizing.maxQtyByCash >= bot.lastOptionSizing.lotSize} value={compactQty(bot.lastOptionSizing.maxQtyByCash)} />
              <StatusRow label="By Exposure" ok={bot.lastOptionSizing.maxQtyByExposure >= bot.lastOptionSizing.lotSize} value={compactQty(bot.lastOptionSizing.maxQtyByExposure)} />
            </div>
            {bot.lastOptionSizing.blocked ? (
              <div className="rounded border border-rose-500/20 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-200">
                {bot.lastOptionSizing.blocked}
              </div>
            ) : (
              <div className="text-[11px] text-slate-500">
                Lot size {bot.lastOptionSizing.lotSize}, final qty {bot.lastOptionSizing.finalQty}. {bot.lastOptionSizing.adjusted ? "Adjusted by risk rules." : "Requested size accepted."}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-bold text-slate-300">Active Cooldowns</span>
          <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${cooldowns.length ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300"}`}>
            {cooldowns.length}
          </span>
        </div>
        {cooldowns.length === 0 ? (
          <div className="text-slate-500">No SL cooldown blocks active.</div>
        ) : (
          <div className="space-y-2">
            {cooldowns.slice(0, 3).map((cooldown) => (
              <div key={cooldown.key} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate text-slate-300">{cooldown.symbol} {cooldown.side}</span>
                <span className={cooldown.repeated ? "text-rose-300" : "text-amber-300"}>
                  {cooldown.repeated ? "day lock" : `${cooldown.remainingMinutes}m`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
