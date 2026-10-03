import { useEffect, useState } from "react";
import { getActiveCooldowns, type ActiveCooldown } from "../../stores/autoBot/cooldown";
import { useMarket, useSettings } from "../../stores";
import { useAutoBot } from "../../stores/autoBotStore";
import type { ChartRuleResult } from "../../lib/chartRules";
import type { ExpiryRuleResult } from "../../lib/expiryRules";
import type { OptionLiquidityResult } from "../../lib/liquidityRules";

type OptionAutoBotChecklistProps = {
  bias: string;
  confluenceScore: number;
  recommendedOption: any;
  expiryRule: ExpiryRuleResult;
  liquidityRule: OptionLiquidityResult;
  chartRule: ChartRuleResult;
};

function CheckLine({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="text-slate-500">{label}</span>
      <span className={ok ? "text-emerald-300" : "text-amber-300"}>{detail}</span>
    </div>
  );
}

export function OptionAutoBotChecklist({
  bias,
  confluenceScore,
  recommendedOption,
  expiryRule,
  liquidityRule,
  chartRule,
}: OptionAutoBotChecklistProps) {
  const bot = useAutoBot();
  const settings = useSettings();
  const market = useMarket();
  const [cooldowns, setCooldowns] = useState<ActiveCooldown[]>(() => getActiveCooldowns());
  const symbol = String(recommendedOption?.option?.symbol || recommendedOption?.row?.ce?.symbol || recommendedOption?.row?.pe?.symbol || "");
  const optionSide = recommendedOption?.side;
  const directionMatch = Boolean(
    optionSide &&
    ((optionSide === "CE" && bias === "Bullish") || (optionSide === "PE" && bias === "Bearish"))
  );
  useEffect(() => {
    const refresh = () => setCooldowns(getActiveCooldowns());
    refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => window.clearInterval(timer);
  }, [bot.lastAction]);

  const cooldown = (() => {
    if (!symbol) return null;
    return cooldowns.find((item) =>
      item.symbol === symbol &&
      item.side === "BUY" &&
      item.strategy === "OPTION_CHAIN_CONFLUENCE"
    );
  })();

  const checks = [
    { label: "Market", ok: market.marketOpen, detail: market.marketOpen ? "Open" : "Closed" },
    { label: "Mode", ok: settings.tradingMode === "paper", detail: settings.tradingMode },
    { label: "Kill Switch", ok: !settings.killSwitch, detail: settings.killSwitch ? "On" : "Off" },
    { label: "Rule Score", ok: confluenceScore >= bot.minConfidence, detail: `${confluenceScore}/100 / ${bot.minConfidence}/100` },
    { label: "Liquidity", ok: liquidityRule.tradeable, detail: liquidityRule.label },
    { label: "Expiry", ok: expiryRule.tradeable, detail: expiryRule.label },
    { label: "Chart", ok: chartRule.tradeable, detail: chartRule.label },
    { label: "Bias Match", ok: directionMatch, detail: optionSide ? `${bias} ${optionSide}` : "No strike" },
    { label: "Cooldown", ok: !cooldown, detail: cooldown ? (cooldown.repeated ? "Day lock" : `${cooldown.remainingMinutes}m`) : "Clear" },
  ];
  const ready = checks.every((check) => check.ok) && Boolean(recommendedOption);

  return (
    <aside className="border-t border-slate-800 bg-slate-950/45 px-3 py-2.5 text-[11px] xl:border-t-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="font-semibold uppercase tracking-wider text-slate-400">Option Auto-Bot Checklist</div>
        <span className={`rounded px-2 py-0.5 font-bold ${ready ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>
          {ready ? "READY" : "BLOCKED"}
        </span>
      </div>
      <div className="grid gap-0.5">
        {checks.map((check) => (
          <CheckLine key={check.label} label={check.label} ok={check.ok} detail={check.detail} />
        ))}
      </div>
    </aside>
  );
}
