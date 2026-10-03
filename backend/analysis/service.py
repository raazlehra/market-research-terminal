import copy
import hashlib
import json
import time
from datetime import datetime, timezone
from typing import Any

from .models import AgentEvidence, AnalysisRequest, AnalysisResult, AnalysisSignal, AssetType
from .providers import BinancePublicMarketDataProvider, FyersReadOnlyMarketDataProvider
from .tradingagents_adapter import (
    TradingAgentsOutputRejected,
    TradingAgentsUnavailable,
)
from .worker_client import AIWorkerClient


class ExecutionDisabledError(RuntimeError):
    pass


class AnalysisService:
    """TradingAgents-inspired research orchestration with no execution capability.

    The useful upstream concepts retained here are specialist evidence, bull/bear
    disagreement, risk review, structured output, and explicit user-triggered
    analysis. Broker tools and portfolio execution are intentionally absent.
    """

    CACHE_SECONDS = 300

    def __init__(
        self,
        market_provider: FyersReadOnlyMarketDataProvider,
        crypto_provider: BinancePublicMarketDataProvider,
        ai_adapter: Any | None = None,
    ) -> None:
        self.market_provider = market_provider
        self.crypto_provider = crypto_provider
        self.ai_adapter = ai_adapter or AIWorkerClient()
        self._cache: dict[str, tuple[float, AnalysisResult]] = {}

    async def market_snapshot(self, request: AnalysisRequest) -> dict[str, Any]:
        if request.asset_type == AssetType.CRYPTO:
            return await self.crypto_provider.market_snapshot(request.symbol, request.resolution or "1h")
        if request.asset_type == AssetType.FNO:
            return await self.market_provider.option_snapshot(request.symbol, request.expiry)
        return await self.market_provider.stock_snapshot(request.symbol, request.resolution or "D", 180)

    async def analyze(self, request: AnalysisRequest) -> AnalysisResult:
        snapshot = await self.market_snapshot(request)
        snapshot_id = hashlib.sha256(json.dumps(snapshot, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:20]
        ai_key = self.ai_adapter.config.fingerprint if request.ai_requested else "deterministic-only"
        key = f"{request.asset_type}:{request.symbol}:{request.horizon}:{request.research_depth}:{snapshot_id}:{ai_key}"
        cached = self._cache.get(key)
        if cached and time.monotonic() - cached[0] < self.CACHE_SECONDS:
            result = copy.deepcopy(cached[1])
            result.cached = True
            result.data_freshness = "CACHED"
            return result
        result = self._synthesize(request, snapshot, snapshot_id)
        if request.ai_requested and self.ai_adapter.config.enabled:
            try:
                overlay = await self.ai_adapter.analyze(
                    snapshot, request.horizon, request.research_depth, request.asset_type.value
                )
                result.signal = overlay.signal
                result.confidence = overlay.confidence
                result.market_bias = (
                    "BULLISH" if overlay.signal in {AnalysisSignal.BUY, AnalysisSignal.STRONG_BUY}
                    else "BEARISH" if overlay.signal in {AnalysisSignal.SELL, AnalysisSignal.STRONG_SELL}
                    else "NEUTRAL"
                )
                result.technical_condition = overlay.technical_summary
                result.bullish_evidence = overlay.bull_case
                result.bearish_evidence = overlay.bear_case
                result.risks = overlay.risks
                result.reasoning_summary = overlay.reasoning_summary
                result.agents = [AgentEvidence.model_validate(agent) for agent in overlay.agents]
                result.model = f"TradingAgents-{self.ai_adapter.config.provider}/{overlay.model}"
                result.analysis_mode = "llm"
                result.ai_status = "completed"
                result.cost_notice = overlay.cost_notice
            except (TradingAgentsUnavailable, TradingAgentsOutputRejected, TimeoutError):
                result.ai_status = "unavailable"
                result.cost_notice = "AI analysis was unavailable; this report uses local deterministic analysis only."
                result.risks.append("Optional AI reasoning failed closed; no unvalidated model output was accepted.")
        elif request.ai_requested:
            result.cost_notice = "No LLM configured; local deterministic analysis was used at no inference cost."
        self._cache[key] = (time.monotonic(), result)
        return result

    def ai_status(self) -> dict[str, Any]:
        return self.ai_adapter.status()

    def reject_execution(self, _: Any = None) -> None:
        raise ExecutionDisabledError("Execution is permanently disabled. Analytical signals cannot become broker or exchange orders.")

    def _synthesize(self, request: AnalysisRequest, snapshot: dict[str, Any], snapshot_id: str) -> AnalysisResult:
        indicators = snapshot.get("indicators") if isinstance(snapshot.get("indicators"), dict) else {}
        market = snapshot.get("market") if isinstance(snapshot.get("market"), dict) else {}
        bullish: list[str] = []
        bearish: list[str] = []
        risks: list[str] = []
        score = 0
        trend = str(indicators.get("trend") or indicators.get("direction") or "UNAVAILABLE").upper()
        rsi = indicators.get("rsi14")
        macd = indicators.get("macd")
        macd_signal = indicators.get("macd_signal")
        volume_condition = str(indicators.get("volume_condition") or "UNAVAILABLE")

        if trend == "BULLISH":
            score += 3
            bullish.append("Price structure is above aligned medium-term moving averages.")
        elif trend == "BEARISH":
            score -= 3
            bearish.append("Price structure is below aligned medium-term moving averages.")
        else:
            risks.append("Trend evidence is mixed or unavailable.")
        if isinstance(rsi, (int, float)):
            if 50 <= rsi <= 70:
                score += 1
                bullish.append(f"RSI ({rsi:.1f}) supports positive momentum without a deterministic overbought claim.")
            elif 30 <= rsi < 50:
                score -= 1
                bearish.append(f"RSI ({rsi:.1f}) shows weak momentum.")
            elif rsi > 70:
                risks.append(f"RSI ({rsi:.1f}) is extended; reversal risk is elevated.")
            elif rsi < 30:
                risks.append(f"RSI ({rsi:.1f}) is depressed; momentum is bearish but snapback risk is elevated.")
        if isinstance(macd, (int, float)) and isinstance(macd_signal, (int, float)):
            if macd > macd_signal:
                score += 1
                bullish.append("MACD is above its signal line.")
            else:
                score -= 1
                bearish.append("MACD is below its signal line.")
        if volume_condition == "ELEVATED":
            risks.append("Volume is elevated; the move may be better confirmed but short-term volatility can also be higher.")

        options_confirmation: str | None = None
        futures_confirmation: str | None = None
        important_strikes = [float(value) for value in snapshot.get("important_strikes", []) if isinstance(value, (int, float))]
        if request.asset_type == AssetType.FNO:
            pcr = market.get("pcr")
            if isinstance(pcr, (int, float)):
                if pcr >= 1.15:
                    score += 1
                    bullish.append(f"Aggregate put/call open-interest ratio is {pcr:.2f}; this is contextual, not proof of put writing.")
                    options_confirmation = "Bullish-leaning OI balance; participant intent cannot be inferred from OI alone."
                elif pcr <= 0.8:
                    score -= 1
                    bearish.append(f"Aggregate put/call open-interest ratio is {pcr:.2f}; this is contextual, not proof of call writing.")
                    options_confirmation = "Bearish-leaning OI balance; participant intent cannot be inferred from OI alone."
                else:
                    options_confirmation = "Option-chain OI balance is broadly neutral."
            else:
                options_confirmation = "Unavailable because valid aggregate OI was not present."
            futures = snapshot.get("futures") if isinstance(snapshot.get("futures"), dict) else {}
            future_market = futures.get("market") if isinstance(futures.get("market"), dict) else {}
            future_instrument = futures.get("instrument") if isinstance(futures.get("instrument"), dict) else {}
            future_indicators = futures.get("indicators") if isinstance(futures.get("indicators"), dict) else {}
            future_price = future_market.get("futures_price")
            spot_price = future_market.get("spot_price")
            basis = future_market.get("basis")
            basis_percent = future_market.get("basis_percent")
            oi_change = future_market.get("change_in_open_interest")
            future_trend = str(future_indicators.get("trend") or "UNAVAILABLE").upper()
            if isinstance(future_price, (int, float)) and isinstance(spot_price, (int, float)):
                basis_text = f"basis {basis:.2f} ({basis_percent:.2f}%)" if isinstance(basis, (int, float)) and isinstance(basis_percent, (int, float)) else "basis unavailable"
                futures_confirmation = f"{future_instrument.get('contract_symbol', 'Active futures contract')}: {basis_text}; trend {future_trend}."
                if future_trend == "BULLISH" and trend == "BULLISH":
                    score += 1
                    bullish.append("The active futures contract trend aligns with the bullish underlying trend.")
                elif future_trend == "BEARISH" and trend == "BEARISH":
                    score -= 1
                    bearish.append("The active futures contract trend aligns with the bearish underlying trend.")
                elif future_trend not in {"UNAVAILABLE", trend}:
                    risks.append("Futures and underlying trend evidence conflict.")
                if isinstance(oi_change, (int, float)):
                    conventional = (
                        "price-up/OI-up (conventionally called long buildup)" if future_trend == "BULLISH" and oi_change > 0
                        else "price-down/OI-up (conventionally called short buildup)" if future_trend == "BEARISH" and oi_change > 0
                        else "price-up/OI-down (conventionally called short covering)" if future_trend == "BULLISH" and oi_change < 0
                        else "price-down/OI-down (conventionally called long unwinding)" if future_trend == "BEARISH" and oi_change < 0
                        else "mixed price/OI structure"
                    )
                    futures_confirmation += f" OI change {oi_change:+.0f}; {conventional}, an interpretation that does not identify participant intent."
            else:
                futures_confirmation = f"Unavailable: {futures.get('reason') or 'verified futures prices were not returned.'}"

        available_signals = len(bullish) + len(bearish)
        if available_signals == 0:
            signal = AnalysisSignal.NO_CLEAR_SETUP
            confidence = 25
        elif score >= 5:
            signal, confidence = AnalysisSignal.STRONG_BUY, min(88, 62 + abs(score) * 4)
        elif score >= 2:
            signal, confidence = AnalysisSignal.BUY, min(80, 55 + abs(score) * 5)
        elif score <= -5:
            signal, confidence = AnalysisSignal.STRONG_SELL, min(88, 62 + abs(score) * 4)
        elif score <= -2:
            signal, confidence = AnalysisSignal.SELL, min(80, 55 + abs(score) * 5)
        else:
            signal, confidence = AnalysisSignal.HOLD, 52 + min(8, available_signals * 2)
        if snapshot.get("data_freshness") == "DELAYED":
            confidence = min(confidence, 55)
            risks.append("The latest provider timestamp is delayed; refresh before relying on this analysis.")
        if request.asset_type == AssetType.CRYPTO:
            risks.append("Crypto trades continuously and can gap through technical levels during liquidity shocks.")
        if not bullish:
            bullish.append("No independently verified bullish evidence met the configured thresholds.")
        if not bearish:
            bearish.append("No independently verified bearish evidence met the configured thresholds.")

        support = indicators.get("support")
        resistance = indicators.get("resistance")
        atr = indicators.get("atr14")
        price = indicators.get("price") or market.get("last_price") or market.get("spot")
        volatility = "Unavailable"
        if isinstance(atr, (int, float)) and isinstance(price, (int, float)) and price:
            atr_pct = atr / price * 100
            volatility = f"ATR is {atr:.4g} ({atr_pct:.2f}% of price); " + ("elevated" if atr_pct >= 3 else "moderate" if atr_pct >= 1 else "contained") + " for this candle interval."

        technical = f"{trend.title()} trend"
        if isinstance(rsi, (int, float)):
            technical += f", RSI {rsi:.1f}"
        asset_label = request.asset_type.value.upper()
        reasoning = f"{asset_label} evidence score {score:+d}. {len(bullish)} bullish and {len(bearish)} bearish observations were reviewed; missing sources remain explicitly unavailable."
        agents = [
            AgentEvidence(agent="Market / Technical Analyst", conclusion=technical, evidence=(bullish + bearish)[:4]),
            AgentEvidence(agent="Bull Researcher", conclusion=bullish[0], evidence=bullish),
            AgentEvidence(agent="Bear Researcher", conclusion=bearish[0], evidence=bearish),
            AgentEvidence(agent="Risk Analyst", conclusion=risks[0] if risks else "No additional deterministic risk flag was triggered.", evidence=risks),
            AgentEvidence(agent="Analysis Decision Agent", conclusion=f"{signal.value} ({confidence}/100)", evidence=[reasoning, "This is an analysis-only label and cannot be executed."]),
        ]
        if request.asset_type == AssetType.FNO:
            agents.insert(1, AgentEvidence(agent="Options Chain Analyst", conclusion=options_confirmation or "Unavailable", evidence=["OI is interpreted as concentration only; buying versus writing is not inferred."]))
        if request.asset_type == AssetType.CRYPTO:
            agents[0].agent = "Crypto Market / Technical Analyst"

        return AnalysisResult(
            instrument=snapshot.get("instrument", {"symbol": request.symbol}), asset_type=request.asset_type,
            horizon=request.horizon, signal=signal, confidence=int(confidence),
            market_bias="BULLISH" if score >= 2 else "BEARISH" if score <= -2 else "NEUTRAL",
            technical_condition=technical,
            fundamental_condition="Unavailable: no verified fundamentals provider is configured." if request.asset_type == AssetType.EQUITY else "Not applicable to this asset analysis.",
            sentiment_news_condition="Unavailable: no grounded news/sentiment provider is configured.",
            futures_confirmation=futures_confirmation, options_oi_confirmation=options_confirmation,
            volatility=volatility, volume_condition=volume_condition,
            bullish_evidence=bullish, bearish_evidence=bearish, risks=risks or ["Signals are probabilistic observations, not forecasts of return."],
            important_levels={"support": support if isinstance(support, (int, float)) else None, "resistance": resistance if isinstance(resistance, (int, float)) else None},
            important_strikes=important_strikes,
            invalidation_conditions=["Provider data becomes stale or unavailable.", "Price closes beyond the identified opposing support/resistance level.", "Previously aligned indicators materially disagree."],
            reasoning_summary=reasoning, agents=agents,
            data_timestamp=str(snapshot.get("data_timestamp") or datetime.now(timezone.utc).isoformat()),
            generated_at=datetime.now(timezone.utc).isoformat(), data_freshness=snapshot.get("data_freshness", "HISTORICAL"),
            data_sources=[str(value) for value in snapshot.get("data_sources", [])], snapshot_id=snapshot_id,
            research_depth=request.research_depth, model="tradingagents-read-only-adapter/rules-v1",
        )
