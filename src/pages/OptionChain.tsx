import { OptionFilters } from "../components/optionchain/OptionFilters";
import { OptionHeader } from "../components/optionchain/OptionHeader";
import { OptionTable } from "../components/optionchain/OptionTable";
import { MarketBiasCard } from "../components/optionchain/MarketBiasCard";
import { SignalBanner } from "../components/optionchain/SignalBanner";
import { useOptionChainModel } from "./optionchain/useOptionChainModel";
import type { OptionChainResponse } from "../lib/api";

export default function OptionChain() {
  const model = useOptionChainModel();
  const chainData = (model.chain.data ?? {}) as Partial<OptionChainResponse>;
  const chainError = model.chain.error instanceof Error ? model.chain.error.message : "";
  const chainStatus = model.chain.isError
    ? chainError || "Option-chain request failed."
    : model.chain.isFetching
      ? "Refreshing option-chain data..."
      : model.rows.length > 0
        ? `${model.rows.length} rows loaded for ${chainData.symbol || model.index}`
        : chainData.message || "No rows received from option-chain API yet.";

  return (
    <div className="flex min-h-screen flex-col gap-3 p-5 animate-in fade-in duration-200">
      <OptionHeader
        s1={model.s1}
        s2={model.s2}
        s1Strength={model.s1Strength}
        s2Strength={model.s2Strength}
        r1={model.r1}
        r2={model.r2}
        r1Strength={model.r1Strength}
        r2Strength={model.r2Strength}
        maxPain={model.maxPain}
        ceWriter={model.ceWriter}
        peWriter={model.peWriter}
        breakout={model.breakout}
        spot={model.spot}
        vwap={model.vwap}
        ema20={model.ema20}
        ema50={model.ema50}
        pcr={model.pcr}
      />

      <SignalBanner
        spot={model.spot}
        vwap={model.vwap}
        ema20={model.ema20}
        ema50={model.ema50}
        effectiveAtm={model.effectiveAtm}
        atmCeConfidence={model.atmCeConfidence}
        atmPeConfidence={model.atmPeConfidence}
        pcr={model.pcr}
      />

      <MarketBiasCard
        bias={model.bias}
        confluenceScore={model.confluenceScore}
        confluenceBreakdown={model.confluenceBreakdown}
        recommendedOption={model.recommendedOption}
        recommendedEntryPrice={model.recommendedEntryPrice}
        recommendedSL={model.recommendedSL}
        recommendedT1={model.recommendedT1}
        recommendedT2={model.recommendedT2}
        expiryRule={model.expiryRule}
        liquidityRule={model.liquidityRule}
        chartRule={model.chartRule}
        lotSize={model.lotSize}
        lots={model.paperLots}
        onLotsChange={model.setPaperLots}
        onBuyCE={() => model.openRecommendedTicket("CE", model.recommendedCall)}
        onBuyPE={() => model.openRecommendedTicket("PE", model.recommendedPut)}
        autoBotLastAction={model.autoBotMessage}
        autoBotBusy={model.autoBotBusy}
        onAutoBotTrade={model.triggerAutoBotOption}
      />

      <OptionFilters
        index={model.index}
        expiries={model.expiries}
        expiry={model.expiry}
        radius={model.radius}
        minOI={model.minOI}
        onIndexChange={model.setIndex}
        onExpiryChange={model.setExpiry}
        onRadiusChange={model.setRadius}
        onMinOIChange={model.setMinOI}
        onRefresh={() => model.chain.refetch()}
        isRefreshing={model.chain.isFetching}
      />

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
        <span className="font-semibold text-slate-300">Option-chain API</span>
        <span>{chainStatus}</span>
        {chainData.fetched_at && (
          <span className="text-slate-500">Updated {new Date(chainData.fetched_at).toLocaleTimeString("en-IN")}</span>
        )}
        <span className="ml-auto">Spot: {model.spot ? `₹${model.spot.toFixed(2)}` : "--"}</span>
      </div>

      <OptionTable
        rows={model.rows}
        effectiveAtm={model.effectiveAtm}
        lotSize={model.lotSize}
        radius={model.radius}
        minOI={model.minOI}
        selectedRow={model.selectedRow}
        setSelectedRow={model.setSelectedRow}
        confidenceMap={model.confidenceMap}
        marketStructureOverall={model.marketStructureOverall}
      />
    </div>
  );
}
