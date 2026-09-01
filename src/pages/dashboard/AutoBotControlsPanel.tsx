import { OPTION_INDEXES } from "../../lib/optionChainModel";
import { SCANNERS } from "../../lib/scanners";
import { MARKET_REGIME_DISPLAY, type MarketRegime } from "../../lib/marketRegime";
import { useAutoBot } from "../../stores";
import type { BotExecutionMode, CandleConfirmationMode, OptionSizingMode } from "../../stores/autoBot/types";
import { TIMEFRAMES } from "../stocks/helpers";

export function AutoBotControlsPanel() {
  const bot = useAutoBot();
  const regimeOptions: MarketRegime[] = ["RANGE", "LOW_VOLUME", "VOLATILE", "TREND_UP", "TREND_DOWN"];

  function toggleGuardedRegime(regime: MarketRegime, checked: boolean) {
    const next = checked
      ? [...bot.guardedRegimes, regime]
      : bot.guardedRegimes.filter((item) => item !== regime);
    bot.setGuardedRegimes(next);
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-xs font-bold text-slate-300">Auto-Bot Controls</div>
        <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${bot.enabled ? (bot.paused ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-300") : "bg-slate-800 text-slate-400"}`}>
          {bot.enabled ? (bot.paused ? "PAUSED" : "ACTIVE") : "STOPPED"}
        </span>
      </div>

      <div className="grid gap-3 text-xs sm:grid-cols-2">
        <label className="space-y-1 text-slate-400">
          <span>Strategy</span>
          <select
            value={bot.strategy}
            onChange={(event) => bot.setStrategy(event.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500"
          >
            {SCANNERS.map((scanner) => (
              <option key={scanner.v} value={scanner.v}>{scanner.label}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-slate-400">
          <span>Universe</span>
          <select
            value={bot.universe}
            onChange={(event) => bot.setUniverse(event.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500"
          >
            <option value="FNO">FnO</option>
            <option value="NIFTY50">Nifty 50</option>
          </select>
        </label>

        <label className="space-y-1 text-slate-400">
          <span>Timeframe</span>
          <select
            value={bot.timeframe}
            onChange={(event) => bot.setTimeframe(event.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500"
          >
            {TIMEFRAMES.map((timeframe) => (
              <option key={timeframe.value} value={timeframe.value}>{timeframe.label}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-slate-400">
          <span>Max Trades</span>
          <input
            type="number"
            min={1}
            max={50}
            value={bot.maxTradesPerDay}
            onChange={(event) => bot.setMaxTradesPerDay(Number(event.target.value))}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100 outline-none focus:border-indigo-500"
          />
        </label>

        <label className="space-y-1 text-slate-400">
          <span>Risk/Trade</span>
          <input
            type="number"
            min={100}
            max={1000000}
            step={100}
            value={bot.riskPerTrade}
            onChange={(event) => bot.setRiskPerTrade(Number(event.target.value))}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100 outline-none focus:border-indigo-500"
          />
        </label>

        <label className="space-y-1 text-slate-400">
          <span>Min T1 R:R</span>
          <input
            type="number"
            min={0.5}
            max={10}
            step={0.1}
            value={bot.minT1RewardRisk}
            onChange={(event) => bot.setMinT1RewardRisk(Number(event.target.value))}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100 outline-none focus:border-indigo-500"
          />
        </label>

        <label className="space-y-1 text-slate-400">
          <span>Min T2 R:R</span>
          <input
            type="number"
            min={0.5}
            max={10}
            step={0.1}
            value={bot.minT2RewardRisk}
            onChange={(event) => bot.setMinT2RewardRisk(Number(event.target.value))}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100 outline-none focus:border-indigo-500"
          />
        </label>
      </div>

      <label className="mt-3 block space-y-2 text-xs text-slate-400">
        <div className="flex items-center justify-between gap-3">
          <span>Min Confidence</span>
          <span className="font-mono font-bold text-slate-100">{bot.minConfidence}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={95}
          step={5}
          value={bot.minConfidence}
          onChange={(event) => bot.setMinConfidence(Number(event.target.value))}
          className="w-full"
        />
      </label>

      <div className="mt-3 grid gap-3 border-t border-slate-800 pt-3 text-xs sm:grid-cols-3">
        <label className="space-y-1 text-slate-400 sm:col-span-3">
          <span>Execution Mode</span>
          <select
            value={bot.executionMode}
            onChange={(event) => bot.setExecutionMode(event.target.value as BotExecutionMode)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500"
          >
            <option value="dry_run">Dry Run - log only</option>
            <option value="paper_auto">Paper Auto - place paper orders</option>
          </select>
        </label>

        <label className="space-y-1 text-slate-400 sm:col-span-3">
          <span>Candle Confirmation</span>
          <select
            value={bot.candleConfirmationMode}
            onChange={(event) => bot.setCandleConfirmationMode(event.target.value as CandleConfirmationMode)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500"
          >
            <option value="off">Off - ignore candle patterns</option>
            <option value="log">Log only - never block</option>
            <option value="block_opposite">Block opposite strong patterns</option>
          </select>
        </label>

        <label className="space-y-1 text-slate-400 sm:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <span>Min Candle Score</span>
            <span className="font-mono font-bold text-slate-100">{bot.minCandleScore}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={bot.minCandleScore}
            disabled={bot.candleConfirmationMode === "off"}
            onChange={(event) => bot.setMinCandleScore(Number(event.target.value))}
            className="w-full disabled:opacity-40"
          />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-slate-300">
          <span>Need Volume</span>
          <input
            type="checkbox"
            checked={bot.requireCandleVolume}
            disabled={bot.candleConfirmationMode === "off"}
            onChange={(event) => bot.setRequireCandleVolume(event.target.checked)}
            className="h-4 w-4 accent-indigo-500 disabled:opacity-40"
          />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-slate-300">
          <span>Adaptive Pattern</span>
          <input
            type="checkbox"
            checked={bot.adaptivePatternConfidenceEnabled}
            disabled={bot.candleConfirmationMode === "off"}
            onChange={(event) => bot.setAdaptivePatternConfidenceEnabled(event.target.checked)}
            className="h-4 w-4 accent-indigo-500 disabled:opacity-40"
          />
        </label>

        <label className="space-y-1 text-slate-400 sm:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <span>Pattern Confidence Cap</span>
            <span className="font-mono font-bold text-slate-100">+/-{bot.maxPatternConfidenceAdjustment}</span>
          </div>
          <input
            type="range"
            min={0}
            max={15}
            step={1}
            value={bot.maxPatternConfidenceAdjustment}
            disabled={!bot.adaptivePatternConfidenceEnabled || bot.candleConfirmationMode === "off"}
            onChange={(event) => bot.setMaxPatternConfidenceAdjustment(Number(event.target.value))}
            className="w-full disabled:opacity-40"
          />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-slate-300">
          <span>Regime Guard</span>
          <input
            type="checkbox"
            checked={bot.regimeGuardEnabled}
            onChange={(event) => bot.setRegimeGuardEnabled(event.target.checked)}
            className="h-4 w-4 accent-indigo-500"
          />
        </label>

        <label className="space-y-1 text-slate-400 sm:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <span>Guard Candle Score</span>
            <span className="font-mono font-bold text-slate-100">{bot.regimeGuardMinCandleScore}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={bot.regimeGuardMinCandleScore}
            disabled={!bot.regimeGuardEnabled}
            onChange={(event) => bot.setRegimeGuardMinCandleScore(Number(event.target.value))}
            className="w-full disabled:opacity-40"
          />
        </label>

        <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-slate-300 sm:col-span-3">
          <div className="flex items-center justify-between gap-3">
            <span>Guarded Regimes</span>
            <span className="font-mono text-[10px] text-slate-500">{bot.guardedRegimes.length}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-5">
            {regimeOptions.map((regime) => (
              <label key={regime} className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-900/50 px-2 py-1.5 text-[10px] text-slate-300">
                <span className="truncate">{MARKET_REGIME_DISPLAY[regime].label}</span>
                <input
                  type="checkbox"
                  checked={bot.guardedRegimes.includes(regime)}
                  disabled={!bot.regimeGuardEnabled}
                  onChange={(event) => toggleGuardedRegime(regime, event.target.checked)}
                  className="h-3.5 w-3.5 accent-indigo-500 disabled:opacity-40"
                />
              </label>
            ))}
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-slate-300">
          <span>Auto Exits</span>
          <input
            type="checkbox"
            checked={bot.autoExitEnabled}
            onChange={(event) => bot.setAutoExitEnabled(event.target.checked)}
            className="h-4 w-4 accent-indigo-500"
          />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-slate-300">
          <span>Trail SL</span>
          <input
            type="checkbox"
            checked={bot.trailingSlEnabled}
            onChange={(event) => bot.setTrailingSlEnabled(event.target.checked)}
            className="h-4 w-4 accent-indigo-500"
          />
        </label>

        <label className="space-y-1 text-slate-400">
          <span>T1 Exit %</span>
          <input
            type="number"
            min={10}
            max={100}
            step={5}
            value={bot.t1ExitPercent}
            onChange={(event) => bot.setT1ExitPercent(Number(event.target.value))}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100 outline-none focus:border-indigo-500"
          />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-slate-300 sm:col-span-3">
          <span>Watch Index Options</span>
          <input
            type="checkbox"
            checked={bot.optionIndexWatchEnabled}
            onChange={(event) => bot.setOptionIndexWatchEnabled(event.target.checked)}
            className="h-4 w-4 accent-indigo-500"
          />
        </label>

        <label className="space-y-1 text-slate-400 sm:col-span-3">
          <span>Option Sizing</span>
          <select
            value={bot.optionSizingMode}
            onChange={(event) => bot.setOptionSizingMode(event.target.value as OptionSizingMode)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-indigo-500"
          >
            <option value="smaller">Smaller of requested, max, and risk</option>
            <option value="risk">Risk-based up to max lots</option>
            <option value="fixed">Fixed requested lots or block</option>
          </select>
        </label>

        <div className="space-y-2 sm:col-span-3">
          <div className="text-slate-400">Index Lot Rules</div>
          <div className="space-y-2">
            {OPTION_INDEXES.map((indexInfo) => {
              const row = bot.optionIndexRisk[indexInfo.label] || { enabled: true, requestedLots: 1, maxLots: 1 };
              return (
                <div key={indexInfo.label} className="grid grid-cols-[1fr_74px_74px_34px] items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate font-bold text-slate-300">{indexInfo.label}</div>
                    <div className="text-[10px] text-slate-500">lot size {indexInfo.lot}</div>
                  </div>
                  <label className="space-y-1 text-[10px] text-slate-500">
                    <span>Req</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={row.requestedLots}
                      onChange={(event) => bot.setOptionIndexRisk(indexInfo.label, { requestedLots: Number(event.target.value) })}
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-indigo-500"
                    />
                  </label>
                  <label className="space-y-1 text-[10px] text-slate-500">
                    <span>Max</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={row.maxLots}
                      onChange={(event) => bot.setOptionIndexRisk(indexInfo.label, { maxLots: Number(event.target.value) })}
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-indigo-500"
                    />
                  </label>
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(event) => bot.setOptionIndexRisk(indexInfo.label, { enabled: event.target.checked })}
                    className="h-4 w-4 justify-self-end accent-indigo-500"
                    aria-label={`${indexInfo.label} enabled`}
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
