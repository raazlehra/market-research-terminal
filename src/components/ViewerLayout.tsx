import { BarChart2, Bitcoin, LayoutDashboard, Layers, ListFilter, LogOut, Radio, Settings, ShieldCheck, TrendingUp } from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { ErrorBoundary } from "./ErrorBoundary";
import { useAuth } from "../stores";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/stocks", label: "Stocks", icon: TrendingUp },
  { to: "/fno", label: "F&O", icon: Layers },
  { to: "/crypto", label: "Crypto", icon: Bitcoin },
  { to: "/watchlist", label: "Watchlist", icon: ListFilter },
  { to: "/charts", label: "Charts", icon: BarChart2 },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function ViewerLayout() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  function handleLogout() { logout(); navigate("/login"); }
  return <div className="flex h-screen w-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.12),transparent_28%),linear-gradient(135deg,#020617_0%,#07111f_46%,#020617_100%)] text-slate-100">
    <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-700/70 bg-slate-950/85 md:flex">
      <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-5"><div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-400/25 bg-emerald-500/10"><Radio className="h-4 w-4 text-emerald-300" /></div><div><div className="text-sm font-bold text-white">Market Research Terminal</div><div className="font-mono text-[9px] uppercase tracking-[0.18em] text-emerald-400">view only · no execution</div></div></div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Primary navigation">{NAV_ITEMS.map((item) => { const Icon = item.icon; return <NavLink key={item.to} to={item.to} className={({ isActive }) => `flex min-h-11 items-center gap-3 rounded-lg border px-3 text-xs font-semibold transition ${isActive ? "border-indigo-400/20 bg-indigo-400/10 text-indigo-200" : "border-transparent text-slate-400 hover:border-slate-700 hover:bg-slate-900 hover:text-white"}`}><Icon className="h-4 w-4" />{item.label}</NavLink>; })}</nav>
      <div className="border-t border-slate-800 p-3"><div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/8 p-2 text-[10px] text-emerald-200"><ShieldCheck className="h-4 w-4" /><span>Analysis only — no orders are placed.</span></div><div className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-xs font-bold">{user?.name?.[0] || "U"}</div><div className="min-w-0 flex-1"><div className="truncate text-xs font-bold">{user?.name || "User"}</div><div className="truncate text-[10px] text-slate-500">FYERS market-data session</div></div><button onClick={handleLogout} title="Sign out" className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"><LogOut className="h-4 w-4" /></button></div></div>
    </aside>
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden"><header className="flex min-h-16 items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/60 px-4"><div><div className="text-xs font-bold text-white">Stocks + F&O + Crypto</div><div className="text-[10px] text-slate-500">Verified market inputs · deterministic indicators · explainable analysis</div></div><div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-200">VIEW ONLY</div></header><main className="min-h-0 flex-1 overflow-y-auto pb-20 md:pb-0"><ErrorBoundary><Outlet /></ErrorBoundary></main></div>
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-800 bg-slate-950/95 p-2 md:hidden" aria-label="Mobile navigation">{NAV_ITEMS.slice(0, 5).map((item) => { const Icon = item.icon; return <NavLink key={item.to} to={item.to} className={({ isActive }) => `flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[10px] ${isActive ? "bg-indigo-500/10 text-indigo-200" : "text-slate-500"}`}><Icon className="h-4 w-4" />{item.label}</NavLink>; })}</nav>
  </div>;
}
