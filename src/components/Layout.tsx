import { useEffect, useRef } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { 
  LayoutDashboard, 
  TrendingUp, 
  ListFilter, 
  Layers, 
  BarChart2, 
  ShoppingBag, 
  Briefcase, 
  History, 
  BookOpen, 
  Wallet, 
  BellRing, 
  Wrench, 
  FileSpreadsheet, 
  Settings as SettingsIcon, 
  LogOut, 
  Bot, 
  Play, 
  Pause, 
  Radio
} from "lucide-react";
import { useAuth, useSettings, useAutoBot } from "../stores";
import { useHealth, usePaperBalance, usePaperOutcomes } from "../hooks";
import { Ticket } from "./Ticket";
import { ErrorBoundary } from "./ErrorBoundary";
import { inr, signColor } from "../lib/utils";
import { api } from "../lib/api";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/stocks", label: "Stocks Selection", icon: TrendingUp, badge: "NEW" },
  { to: "/watchlist", label: "Watchlist", icon: ListFilter },
  { to: "/option-chain", label: "Option Chain", icon: Layers },
  { to: "/charts", label: "Charts", icon: BarChart2 },
  { to: "/orders", label: "Orders", icon: ShoppingBag },
  { to: "/positions", label: "Positions", icon: Briefcase },
  { to: "/trades", label: "Trade Book", icon: History },
  { to: "/journal", label: "Journal", icon: BookOpen },
  { to: "/paper", label: "Paper Wallet", icon: Wallet },
  { to: "/alerts", label: "Alerts", icon: BellRing },
  { to: "/strategies", label: "Strategies", icon: Wrench },
  { to: "/reports", label: "Reports", icon: FileSpreadsheet },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

const MOBILE_NAV_ITEMS = NAV_ITEMS.filter((item) =>
  ["/dashboard", "/watchlist", "/option-chain", "/orders", "/paper"].includes(item.to),
);

export function Layout() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const { update: updateSettings } = useSettings();
  const bot = useAutoBot();
  const health = useHealth();
  const backendSettings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.getSettings(),
    staleTime: 60000,
  });
  const backendBotSettings = useQuery({
    queryKey: ["bot-settings"],
    queryFn: () => api.getBotSettings(),
    staleTime: 60000,
  });
  const backendBotDecisions = useQuery({
    queryKey: ["bot-decisions"],
    queryFn: () => api.getBotDecisions(50),
    staleTime: 30000,
  });
  const botSettingsMigratedRef = useRef(false);

  useEffect(() => {
    const data = backendSettings.data;
    if (!data || typeof data !== "object" || Object.keys(data).length === 0) return;
    const { autoBot: _autoBot, ...settingsOnly } = data as any;
    updateSettings(settingsOnly);
  }, [backendSettings.data, updateSettings]);

  useEffect(() => {
    const data = backendBotSettings.data;
    if (!data || typeof data !== "object" || Object.keys(data).length === 0) return;
    useAutoBot.getState().hydrateBotConfig(data);
  }, [backendBotSettings.data]);

  useEffect(() => {
    const data = backendBotDecisions.data;
    if (!Array.isArray(data)) return;
    useAutoBot.getState().hydrateDecisionLog(data);
  }, [backendBotDecisions.data]);

  useEffect(() => {
    const data = backendBotSettings.data;
    if (!backendBotSettings.isSuccess || botSettingsMigratedRef.current) return;
    if (data && typeof data === "object" && Object.keys(data).length > 0) return;
    botSettingsMigratedRef.current = true;
    const current = useAutoBot.getState();
    void api.saveBotSettings({
      strategy: current.strategy,
      universe: current.universe,
      timeframe: current.timeframe,
      minConfidence: current.minConfidence,
      riskPerTrade: current.riskPerTrade,
      maxTradesPerDay: current.maxTradesPerDay,
      minT1RewardRisk: current.minT1RewardRisk,
      minT2RewardRisk: current.minT2RewardRisk,
      autoExitEnabled: current.autoExitEnabled,
      trailingSlEnabled: current.trailingSlEnabled,
      optionIndexWatchEnabled: current.optionIndexWatchEnabled,
      executionMode: current.executionMode,
      candleConfirmationMode: current.candleConfirmationMode,
      minCandleScore: current.minCandleScore,
      requireCandleVolume: current.requireCandleVolume,
      adaptivePatternConfidenceEnabled: current.adaptivePatternConfidenceEnabled,
      maxPatternConfidenceAdjustment: current.maxPatternConfidenceAdjustment,
      optionSizingMode: current.optionSizingMode,
      optionIndexRisk: current.optionIndexRisk,
      t1ExitPercent: current.t1ExitPercent,
    }).catch(() => {});
  }, [backendBotSettings.data, backendBotSettings.isSuccess]);
  
  // Active wallet stats
  const paperBal = usePaperBalance();
  const paperOutcomes = usePaperOutcomes();
  const paperBalance = paperBal.data as { unrealized?: number; available?: number } | undefined;
  
  const currentPnl = paperBalance?.unrealized || 0;
  const cashAvail = paperBalance?.available || 1000000;
  const dayTradesCount = countTodayPaperTradeIdeas(paperOutcomes.data);

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.12),transparent_28%),linear-gradient(135deg,#020617_0%,#07111f_46%,#020617_100%)] text-slate-100">
      
      {/* Left Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-700/70 bg-slate-950/85 shadow-2xl shadow-black/25 backdrop-blur-xl md:flex">
        
        {/* Brand Header */}
        <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-400/25 bg-emerald-500/10 shadow-[0_0_24px_rgba(22,163,74,0.16)]">
            <Radio className="h-4 w-4 text-emerald-300" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold tracking-tight text-white">FnO Terminal</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">Fyers v3 / Pro Alpha</div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex min-h-11 items-center gap-3 rounded-lg border px-3 text-xs font-semibold transition duration-200 ${
                    isActive
                      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200 shadow-sm shadow-emerald-950/30"
                      : "border-transparent text-slate-400 hover:border-slate-700 hover:bg-slate-900/80 hover:text-slate-100"
                  }`
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
                {item.badge && (
                  <span className="ml-auto rounded border border-sky-400/20 bg-sky-400/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-sky-300">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* User Info & Quick Logout */}
        <div className="border-t border-slate-800 bg-slate-950/60 p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-xs font-bold text-emerald-300">
              {user?.name?.[0] || "U"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-bold text-slate-100">{user?.name || "Pro Trader"}</div>
              <div className="text-[10px] text-slate-500 truncate">{user?.id || "FYERS CLIENT"}</div>
            </div>
            <button 
              onClick={handleLogout}
              title="Sign Out" 
              className="min-h-8 min-w-8 rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
          
          <div className="flex items-center justify-between text-[10px] text-slate-500">
            <span>Proxy Status:</span>
            <span className={`font-semibold ${health.data?.ok ? "text-emerald-400" : "text-rose-400"}`}>
              {health.data?.ok ? "ONLINE" : "SIMULATED"}
            </span>
          </div>
        </div>

      </aside>

      {/* Main Container */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        
        {/* Top Advanced Header */}
        <header className="flex h-16 items-center justify-between gap-2 border-b border-slate-800/90 bg-slate-950/60 px-3 backdrop-blur-xl sm:px-6">
          
          {/* Auto Bot Premium Center */}
          <div className="flex min-w-0 items-center gap-3">
            <div className={`terminal-chip flex items-center gap-2 rounded-lg px-3 py-1 ${bot.enabled ? (bot.paused ? "border-amber-500/30 bg-amber-500/8 text-amber-300" : "border-emerald-500/30 bg-emerald-500/8 text-emerald-300") : "text-slate-400"}`}>
              <Bot className={`h-4 w-4 ${bot.enabled && !bot.paused ? "text-emerald-400" : ""}`} />
              <div className="text-xs">
                <span className="font-bold">Bot: </span>
                <span className="font-mono text-[11px]">
                  {bot.enabled ? (bot.paused ? "PAUSED" : "ACTIVE") : "OFF"}
                </span>
              </div>
              
              {/* ON/OFF Switch */}
              <button
                type="button"
                onClick={bot.toggleEnabled}
                className={`ml-1 min-h-7 rounded-md px-2 text-[10px] font-bold transition ${bot.enabled ? "bg-rose-500/20 text-rose-200 hover:bg-rose-500/30" : "bg-emerald-600 text-white hover:bg-emerald-500"}`}
              >
                {bot.enabled ? "STOP" : "START"}
              </button>

              {/* Pause/Resume Switch */}
              {bot.enabled && (
                <button
                  type="button"
                  onClick={bot.togglePaused}
                  className={`min-h-7 min-w-7 rounded-md p-1 transition hover:bg-slate-800 ${bot.paused ? "text-emerald-400" : "text-amber-400"}`}
                  title={bot.paused ? "Resume Bot" : "Pause Bot"}
                >
                  {bot.paused ? <Play className="h-3 w-3 fill-current" /> : <Pause className="h-3 w-3 fill-current" />}
                </button>
              )}
            </div>

            {/* Last Bot Message ticker */}
            <div className="hidden max-w-sm truncate font-mono text-[11px] text-slate-500 lg:block">
              <span className="text-emerald-400">status</span> / {bot.lastAction}
            </div>
          </div>

          {/* Wallet Summary & Paper Mode Status */}
          <div className="flex items-center gap-4">
            
            {/* Wallet Badges */}
            <div className="hidden items-center gap-4 border-r border-slate-800 pr-4 text-xs md:flex">
              <div>
                <span className="text-[10px] text-slate-500 uppercase block">Available Margin</span>
                <span className="font-mono font-bold text-slate-200">{inr(cashAvail)}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 uppercase block">Open P&L</span>
                <span className={`font-mono font-bold ${signColor(currentPnl)}`}>{inr(currentPnl)}</span>
              </div>
              <div className="hidden sm:block">
                <span className="text-[10px] text-slate-500 uppercase block">Day Trades</span>
                <span className="font-mono font-bold text-slate-300">{dayTradesCount}</span>
              </div>
            </div>

            <div className="flex min-h-11 items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3">
              <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.85)]" />
              <div>
                <div className="text-xs font-bold text-emerald-200">Paper Mode Only</div>
                <div className="hidden text-[10px] text-slate-500 sm:block">Live Fyers data, simulated orders</div>
              </div>
            </div>

          </div>

        </header>

        {/* Routed Views */}
        <main className="relative min-h-0 flex-1 overflow-y-auto pb-20 md:pb-0">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>

      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-800 bg-slate-950/94 px-2 py-2 backdrop-blur-xl md:hidden" aria-label="Mobile navigation">
        {MOBILE_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-bold transition ${
                  isActive
                    ? "bg-emerald-400/10 text-emerald-200"
                    : "text-slate-500 hover:bg-slate-900 hover:text-slate-200"
                }`
              }
            >
              <Icon className="h-4 w-4" />
              <span className="max-w-full truncate px-1">{item.label.replace("Option Chain", "Chain").replace("Paper Wallet", "Paper")}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Persistent Order Ticket Modals */}
      <Ticket />

    </div>
  );
}

function countTodayPaperTradeIdeas(outcomes: any) {
  const rows = Array.isArray(outcomes) ? outcomes : [];
  return rows.filter((outcome: any) => {
    const raw = outcome?.signalTime || outcome?.createdAt || outcome?.time;
    if (!raw) return false;
    const dt = new Date(raw);
    return !Number.isNaN(dt.getTime()) && dt.toDateString() === new Date().toDateString();
  }).length;
}
