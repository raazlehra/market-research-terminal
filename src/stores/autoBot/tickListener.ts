import { useSettings } from "../settingsStore";
import { localDayKey } from "./storage";
import type { AutoBotState } from "./types";

export function installAutoBotTickListener(getBot: () => AutoBotState) {
  if (typeof window === "undefined") return;
  window.addEventListener("fyers_ticks", (event: any) => {
    const bot = getBot();
    const settings = useSettings.getState();
    if (!bot.enabled || bot.paused || settings.killSwitch) return;

    const detail = event.detail || {};
    const ticksList: any[] = detail.type === "tick" && detail.payload
      ? [detail.payload]
      : Object.keys(detail).map((key) => detail[key]).filter((tick) => tick?.ltp);

    ticksList.forEach((tick) => {
      if (!tick?.ltp || !tick?.symbol) return;

      const changePct = Number(tick.chp || tick.changePct || 0);
      const volume = Number(tick.volume || tick.vol || 0);
      if (volume <= 500000 || Math.abs(changePct) <= 2.5) return;

      const side = changePct > 0 ? "BUY" : "SELL";
      const firedKey = `bot_tick_fired_${localDayKey()}_${tick.symbol}`;
      if (sessionStorage.getItem(firedKey)) return;

      sessionStorage.setItem(firedKey, "true");
      void bot.triggerBotTrade(
        tick.symbol,
        side,
        Math.max(1, Number(settings.defaultQty || 1)),
        `Real-time volume breakout detected on ${tick.symbol} (${changePct.toFixed(2)}%)`,
        {
          price: Number(tick.ltp || 0),
          confidence: bot.minConfidence,
          strategy: bot.strategy,
          source: "tick",
        }
      );
    });
  });
}
