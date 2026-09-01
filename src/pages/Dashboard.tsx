import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bot,
  Layers,
  ShieldAlert,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import { socket } from "../lib/api";
import {
  useOrders,
  usePaperBalance,
  usePaperOutcomes,
  usePaperPositions,
  usePaperTrades,
  usePositions,
  useTradebook,
} from "../hooks";
import { useAutoBot, useMarket, useSettings, useTicket } from "../stores";
import { inr, pct, signColor } from "../lib/utils";

import { StatCard } from "./dashboard/DashboardCards";
import { OrdersAutomationPanel } from "./dashboard/OrdersAutomationPanel";
import { TOP_INDEXES, asList, isToday, itemTime, positionPnl, positionQty, queryIssue, toNumber, tradePrice, tradeSide, tradeSymbol } from "./dashboard/helpers";
export { StatusPill } from "./dashboard/DashboardCards";

export default function Dashboard() {
  const openTicket = useTicket((s) => s.openFor);
  const settings = useSettings();
  const bot = useAutoBot();
  const market = useMarket();
  const ticks = useMarket((s) => s.ticks);

  const paperBal = usePaperBalance();
  const paperOutcomes = usePaperOutcomes();
  const paperPositions = usePaperPositions();
  const paperTrades = usePaperTrades();
  const livePositions = usePositions();
  const liveTrades = useTradebook();
  const liveOrders = useOrders();

  const isPaper = true;
  const benchmarkSymbols = useMemo(() => TOP_INDEXES.map((i) => i.symbol), []);

  useEffect(() => {
    socket.subscribe(benchmarkSymbols);
    return () => socket.unsubscribe(benchmarkSymbols);
  }, [benchmarkSymbols]);

  const positions = isPaper ? asList(paperPositions.data) : asList(livePositions.data);
  const trades = isPaper ? asList(paperTrades.data) : asList(liveTrades.data);
  const paperTradeIdeas = asList(paperOutcomes.data);
  const orders = asList(liveOrders.data);
  const todayTrades = trades.filter(isToday);
  const todayTradeIdeas = paperTradeIdeas.filter(isToday);
  const openPositions = positions.filter((p) => positionQty(p) !== 0);
  const recentTrades = [...trades].sort((a, b) => new Date(itemTime(b) || 0).getTime() - new Date(itemTime(a) || 0).getTime()).slice(0, 5);

  const issue = isPaper
    ? queryIssue(paperBal, paperPositions, paperTrades, paperOutcomes)
    : queryIssue(livePositions, liveTrades, liveOrders);

  const paperBalData = paperBal.data as any;
  const startBal = isPaper ? toNumber(paperBalData?.starting, 1000000) : 0;
  const availBal = isPaper ? toNumber(paperBalData?.available, 1000000) : 0;
  const usedMargin = isPaper ? Math.max(startBal - availBal, 0) : 0;
  const pnl = isPaper ? toNumber(paperBalData?.unrealized) : openPositions.reduce((sum, p) => sum + positionPnl(p), 0);
  const tradesCount = isPaper ? todayTradeIdeas.length : todayTrades.length;
  const exposure = openPositions.reduce((sum, p) => {
    const qty = Math.abs(positionQty(p));
    const price = toNumber(p?.ltp ?? p?.price ?? p?.avg_price ?? p?.averagePrice);
    return sum + qty * price;
  }, 0);
  const tradeAllowance = Math.max(settings.riskMaxTrades - tradesCount, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-black text-white tracking-tight">Terminal Command Center</h1>
            <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${isPaper ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30" : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"}`}>
              PAPER WALLET ACTIVE
            </span>
            <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${market.marketOpen ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20" : "bg-slate-800 text-slate-300 border border-slate-700"}`}>
              {market.marketOpen ? "MARKET OPEN" : market.marketStatus.toUpperCase()}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Account, risk, benchmark, and execution state from the active trading mode.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            to="/stocks"
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white shadow-md hover:bg-indigo-500"
          >
            <Sparkles className="h-4 w-4" />
            <span>Stocks Strategies</span>
          </Link>
          <Link
            to="/option-chain"
            className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-slate-200 border border-slate-800 hover:bg-slate-800"
          >
            <Layers className="h-4 w-4 text-indigo-400" />
            <span>Option Chain</span>
          </Link>
        </div>
      </div>

      {issue && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-3 text-xs text-slate-400">
          {issue === "Loading" ? "Loading dashboard data..." : "Some dashboard data is unavailable. Showing the latest local values where possible."}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Wallet className="h-3.5 w-3.5 text-indigo-400" />}
          label={isPaper ? "Available Paper Cash" : "Live Cash"}
          value={isPaper ? inr(availBal) : "Connect funds"}
          hint={isPaper ? `Used: ${inr(usedMargin)}` : "Live funds endpoint is not wired here yet"}
        />
        <StatCard
          icon={<Activity className="h-3.5 w-3.5 text-emerald-400" />}
          label="Open P&L"
          value={inr(pnl)}
          hint={`${openPositions.length} open position${openPositions.length === 1 ? "" : "s"}`}
          valueClass={signColor(pnl)}
        />
        <StatCard
          icon={<ShoppingBag className="h-3.5 w-3.5 text-amber-400" />}
          label="Today's Executed Trades"
          value={tradesCount}
          hint={`${tradeAllowance} trades left by risk setting`}
        />
        <StatCard
          icon={<Bot className="h-3.5 w-3.5 text-violet-400" />}
          label="Auto-Bot Status"
          value={bot.enabled ? (bot.paused ? "PAUSED" : "ACTIVE") : "OFF"}
          hint={bot.enabled ? `${bot.strategy} - ${bot.tradesExecuted} fills today` : "Manual trading mode"}
        />
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Core Indian Benchmarks</div>
          <div className="text-[10px] text-slate-500">Uses live ticks when connected; otherwise shows last fallback values.</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {TOP_INDEXES.map((idx) => {
            const tick = ticks[idx.symbol] || {};
            const ltp = toNumber(tick.ltp, idx.fallbackLtp);
            const chp = toNumber(tick.chp ?? tick.changePct ?? tick.percent_change, idx.fallbackChp);
            const isPos = chp >= 0;
            const isLive = Boolean(tick.ltp);
            return (
              <div key={idx.symbol} className="rounded-xl border border-slate-800/60 bg-slate-900/20 p-3.5 hover:bg-slate-900/40 transition space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-slate-300">{idx.label}</span>
                  <span className={`flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded ${isPos ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
                    {isPos ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                    {pct(chp)}
                  </span>
                </div>

                <div className="flex items-baseline justify-between">
                  <span className="text-lg font-black font-mono text-white">{inr(ltp)}</span>
                  <span className={`text-[10px] font-mono ${isLive ? "text-emerald-400" : "text-slate-500"}`}>
                    {isLive ? "LIVE" : "FALLBACK"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-slate-800/40">
                  <Link to="/charts" className="rounded bg-indigo-500/10 py-1 text-center text-[10px] font-bold text-indigo-300 hover:bg-indigo-500/20">
                    Chart
                  </Link>
                  <Link to="/option-chain" className="rounded bg-slate-800/70 py-1 text-center text-[10px] font-bold text-slate-300 hover:bg-slate-800">
                    Chain
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white">Risk Controls</h3>
            </div>
            <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${settings.killSwitch ? "bg-rose-500/15 text-rose-300" : "bg-emerald-500/15 text-emerald-300"}`}>
              {settings.killSwitch ? "KILL SWITCH ON" : "ACTIVE"}
            </span>
          </div>
          <div className="space-y-3 text-xs">
            <div className="flex justify-between"><span className="text-slate-500">Daily loss limit</span><span className="font-mono text-slate-200">{inr(settings.riskMaxDailyLoss)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Max trades</span><span className="font-mono text-slate-200">{settings.riskMaxTrades}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Open exposure</span><span className="font-mono text-slate-200">{inr(exposure)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Exposure limit</span><span className="font-mono text-slate-200">{inr(settings.riskMaxExposure)}</span></div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 space-y-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-indigo-400" />
              <h3 className="text-sm font-bold text-white">Open Positions</h3>
            </div>
            <Link to="/positions" className="text-xs text-indigo-400 hover:underline">View all</Link>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-800/60">
            <table className="w-full text-xs">
              <thead className="bg-slate-950/70 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Symbol</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Avg</th>
                  <th className="px-3 py-2 text-right">P&L</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {openPositions.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-slate-500">No open positions.</td></tr>
                )}
                {openPositions.slice(0, 5).map((p, i) => {
                  const sym = p.symbol || p.tradingSymbol || "-";
                  const qty = positionQty(p);
                  const avg = toNumber(p.avg_price ?? p.averagePrice ?? p.avgPrice);
                  const posPnl = positionPnl(p);
                  return (
                    <tr key={`${sym}-${i}`} className="border-t border-slate-800/60">
                      <td className="px-3 py-2 font-bold text-slate-200">{sym}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{qty}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{inr(avg)}</td>
                      <td className={`px-3 py-2 text-right font-mono font-bold ${signColor(posPnl)}`}>{inr(posPnl)}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => openTicket({ symbol: sym, side: qty >= 0 ? "SELL" : "BUY", qty: Math.abs(qty) || 1, orderType: "MARKET", price: toNumber(p.ltp ?? avg) })}
                          className="rounded bg-slate-800 px-2 py-1 text-[10px] font-bold text-slate-200 hover:bg-slate-700"
                        >
                          Exit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white">Recent Executions</h3>
            </div>
            <Link to="/trades" className="text-xs text-indigo-400 hover:underline">Trade book</Link>
          </div>

          <div className="space-y-2.5">
            {recentTrades.length === 0 && <div className="py-8 text-center text-xs text-slate-500">No recent executions.</div>}
            {recentTrades.map((t, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl bg-slate-950/40 p-3 border border-slate-800/30">
                <div>
                  <div className="font-bold text-xs text-slate-200">{tradeSymbol(t)}</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">{tradeSide(t)} {toNumber(t.qty ?? t.quantity)} qty</div>
                </div>
                <div className="text-right font-mono text-xs">
                  <div className="text-slate-300">{inr(tradePrice(t))}</div>
                  <div className="text-[10px] text-slate-500">{itemTime(t) ? new Date(itemTime(t)).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--"}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <OrdersAutomationPanel orders={orders} paperOutcomes={paperTradeIdeas} />
      </div>
    </div>
  );
}
