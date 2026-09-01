import type { MarketRegimeSignal } from "../../lib/marketRegime";
import type { CandlestickSignal } from "../../lib/candlestickPatterns";
import type { AutoBotState } from "./types";

export function regimeGuardBlock(
  bot: AutoBotState,
  candleRule: { regime: MarketRegimeSignal; signal: CandlestickSignal }
): string {
  if (!bot.regimeGuardEnabled) return "";
  if (!bot.guardedRegimes.includes(candleRule.regime.regime)) return "";
  if (candleRule.signal.score >= bot.regimeGuardMinCandleScore) return "";
  return `regime ${candleRule.regime.regime} needs candle ${bot.regimeGuardMinCandleScore}%`;
}
