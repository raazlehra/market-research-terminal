import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity, ArrowRight, BookOpen, Check, Clock3, Database,
  ExternalLink, Gauge, LoaderCircle, LogIn, RefreshCw, Server,
  ShieldCheck, Wifi, X, Zap,
} from "lucide-react";
import { SYSTEM_ENDPOINTS } from "../lib/api";
import { useAuth } from "../stores";

type State = "idle" | "checking" | "online" | "offline" | "optional";
type Health = { ok: boolean; fyers: boolean; redis: boolean; db: boolean };
type ServiceCheck = { label: string; detail: string; state: State; icon: typeof Server; optional?: boolean };

const initial: ServiceCheck[] = [
  { label: "Backend", detail: "FastAPI service", state: "idle", icon: Server },
  { label: "Fyers", detail: "Broker session", state: "idle", icon: Activity },
  { label: "Database", detail: "Local persistence", state: "idle", icon: Database },
  { label: "Redis", detail: "Optional cache", state: "optional", icon: Gauge, optional: true },
];

const stateText: Record<State, string> = {
  idle: "Not checked", checking: "Checking", online: "Online",
  offline: "Offline", optional: "Not required",
};

function statusClass(state: State) {
  if (state === "online") return "border-emerald-400/25 bg-emerald-400/10 text-emerald-300";
  if (state === "offline") return "border-rose-400/25 bg-rose-400/10 text-rose-300";
  if (state === "checking") return "border-sky-400/25 bg-sky-400/10 text-sky-300";
  if (state === "optional") return "border-amber-400/25 bg-amber-400/10 text-amber-300";
  return "border-slate-700 bg-slate-800/50 text-slate-400";
}

export default function SystemCheck() {
  const token = useAuth((s) => s.token);
  const [checks, setChecks] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const runChecks = useCallback(async () => {
    setBusy(true);
    setError(null);
    setChecks(initial.map((item) => ({ ...item, state: item.optional ? "optional" : "checking" })));
    const start = performance.now();
    try {
      const response = await fetch(SYSTEM_ENDPOINTS.health, {
        cache: "no-store", signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`Backend returned HTTP ${response.status}`);
      const data = (await response.json()) as Partial<Health>;
      if (typeof data.ok !== "boolean") throw new Error("Invalid health response");
      setLatency(Math.round(performance.now() - start));
      setChecks([
        { ...initial[0], state: data.ok ? "online" : "offline" },
        { ...initial[1], state: data.fyers ? "online" : "offline" },
        { ...initial[2], state: data.db ? "online" : "offline" },
        { ...initial[3], state: data.redis ? "online" : "optional" },
      ]);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to reach backend";
      setError(message.includes("fetch") ? "Backend is unreachable. Start FastAPI on port 8000 and retry." : message);
      setLatency(null);
      setChecks([
        { ...initial[0], state: "offline" }, { ...initial[1], state: "offline" },
        { ...initial[2], state: "offline" }, initial[3],
      ]);
    } finally {
      setLastChecked(new Date());
      setBusy(false);
    }
  }, []);

  useEffect(() => { void runChecks(); }, [runChecks]);

  async function startLogin() {
    setLoginBusy(true);
    setError(null);
    try {
      const response = await fetch(SYSTEM_ENDPOINTS.loginUrl, {
        cache: "no-store", signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`Login service returned HTTP ${response.status}`);
      const data = (await response.json()) as { url?: unknown };
      if (typeof data.url !== "string") throw new Error("Login service returned an invalid URL");
      const target = new URL(data.url);
      if (target.protocol !== "https:" || !target.hostname.endsWith("fyers.in")) {
        throw new Error("Login service returned an untrusted destination");
      }
      window.location.assign(target.toString());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start Fyers login");
      setLoginBusy(false);
    }
  }

  const backendOnline = checks[0].state === "online";

  return (
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(37,99,235,.2),transparent_30%),radial-gradient(circle_at_85%_20%,rgba(124,58,237,.16),transparent_32%),linear-gradient(rgba(148,163,184,.025)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,.025)_1px,transparent_1px)] bg-[size:auto,auto,32px_32px,32px_32px]" />
      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 shadow-lg shadow-blue-500/20"><Zap className="h-5 w-5" /></div>
            <div><div className="font-semibold">FnO Terminal</div><div className="text-[10px] uppercase tracking-[.2em] text-slate-500">Pre-flight console</div></div>
          </div>
          <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${backendOnline ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : "border-slate-700 bg-slate-900/70 text-slate-400"}`}>
            <span className={`h-2 w-2 rounded-full ${backendOnline ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.8)]" : "bg-slate-600"}`} />
            {backendOnline ? "Systems reachable" : "Awaiting systems"}
          </div>
        </header>

        <section className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1.05fr_.95fr] lg:py-16">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-blue-400/20 bg-blue-400/10 px-3 py-1.5 text-xs text-blue-300"><ShieldCheck className="h-3.5 w-3.5" /> Safe, read-only diagnostics</div>
            <h1 className="max-w-2xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-6xl">Know your stack is ready <span className="block bg-gradient-to-r from-sky-400 via-blue-400 to-violet-400 bg-clip-text text-transparent">before the market moves.</span></h1>
            <p className="mt-5 max-w-xl text-sm leading-6 text-slate-400 sm:text-base">Verify the local API, broker session, and database from one place. These checks do not place orders or expose credentials.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button onClick={() => void runChecks()} disabled={busy} className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold shadow-lg shadow-blue-600/20 transition hover:bg-blue-500 disabled:opacity-60">
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {busy ? "Running checks" : "Run All Checks"}
              </button>
              <Link to={token ? "/dashboard" : "/login"} className="group flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/70 px-5 py-3 text-sm font-semibold transition hover:bg-slate-800">Continue to Terminal <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5" /></Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-500">
              <span className="flex items-center gap-2"><Clock3 className="h-3.5 w-3.5" />{lastChecked ? `Checked ${lastChecked.toLocaleTimeString()}` : "Not checked yet"}</span>
              <span className="flex items-center gap-2"><Wifi className="h-3.5 w-3.5" />{latency === null ? "Response time --" : `${latency} ms response`}</span>
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800/80 bg-slate-900/65 p-5 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-7">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-blue-400">System status</p><h2 className="mt-1 text-xl font-semibold">Local environment</h2></div>
              <div className="rounded-lg border border-slate-800 bg-slate-950/70 px-2.5 py-1.5 font-mono text-[10px] text-slate-500">127.0.0.1:8000</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {checks.map((item) => {
                const Icon = item.icon;
                return <div key={item.label} className="rounded-2xl border border-slate-800 bg-slate-950/55 p-4 transition hover:border-slate-700">
                  <div className="flex items-start justify-between gap-2">
                    <div className="rounded-xl border border-slate-800 bg-slate-900 p-2.5"><Icon className="h-4 w-4" /></div>
                    <span className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${statusClass(item.state)}`}>
                      {item.state === "checking" ? <LoaderCircle className="h-3 w-3 animate-spin" /> : item.state === "online" ? <Check className="h-3 w-3" /> : item.state === "offline" ? <X className="h-3 w-3" /> : null}{stateText[item.state]}
                    </span>
                  </div>
                  <div className="mt-4 text-sm font-semibold">{item.label}</div><div className="mt-0.5 text-xs text-slate-500">{item.detail}</div>
                </div>;
              })}
            </div>
            {error && <div role="alert" className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-xs text-rose-200"><span>{error}</span><button onClick={() => void runChecks()} className="shrink-0 font-semibold">Retry</button></div>}
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <a href={SYSTEM_ENDPOINTS.docs} target="_blank" rel="noreferrer" className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-3 text-sm font-medium transition hover:bg-slate-800"><span className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-sky-400" />API Documentation</span><ExternalLink className="h-3.5 w-3.5 text-slate-500" /></a>
              <button onClick={() => void startLogin()} disabled={loginBusy} className="flex items-center justify-between rounded-xl border border-violet-400/20 bg-violet-500/10 px-4 py-3 text-sm font-medium text-violet-100 transition hover:bg-violet-500/20 disabled:opacity-60"><span className="flex items-center gap-2">{loginBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4 text-violet-400" />}Fyers Login</span><ExternalLink className="h-3.5 w-3.5 text-violet-400/60" /></button>
            </div>
          </div>
        </section>
        <footer className="flex flex-col gap-2 border-t border-slate-800/70 py-5 text-[11px] text-slate-600 sm:flex-row sm:justify-between"><span>Development diagnostics · No live order execution</span><span>Backend health · OAuth gateway · API reference</span></footer>
      </div>
    </main>
  );
}
