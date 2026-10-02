import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Radio, ShieldCheck, WifiOff } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../stores";
import { useHealth } from "../hooks";

export default function Login() {
  const navigate = useNavigate();
  const { setToken, token } = useAuth();
  const health = useHealth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const handoff = new URLSearchParams(window.location.search).get("handoff");
    if (!handoff) return;
    window.history.replaceState({}, "", "/login");
    void complete(handoff);
  }, []);

  useEffect(() => {
    if (token) navigate("/dashboard");
  }, [token, navigate]);

  async function startOAuth() {
    setErr(null);
    try {
      const { url } = await api.loginUrl();
      window.location.assign(url);
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : "Failed to start FYERS login.");
    }
  }

  async function complete(handoff: string) {
    setBusy(true);
    setErr(null);
    try {
      const response = await api.completeLogin(handoff);
      setToken(response.session_token, response.user);
      navigate("/dashboard");
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : "Failed to complete FYERS login.");
    } finally {
      setBusy(false);
    }
  }

  const backendStatus = health.data?.ok ? "Online" : health.isLoading ? "Checking" : "Offline";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_20%_20%,rgba(22,163,74,0.16),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(37,99,235,0.14),transparent_30%),linear-gradient(135deg,#020617_0%,#07111f_48%,#020617_100%)] p-6 text-slate-100">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-xl border border-slate-700/80 bg-slate-950/80 shadow-2xl shadow-black/35 backdrop-blur-xl md:grid-cols-[1.05fr_0.95fr]">
        <section className="border-b border-slate-800 p-8 md:border-b-0 md:border-r">
          <div className="mb-8 flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-lg border border-emerald-400/25 bg-emerald-500/10"><Radio className="h-5 w-5 text-emerald-300" /></div><div><div className="text-lg font-bold tracking-tight text-white">Market Research Terminal</div><div className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-400">View only · no execution</div></div></div>
          <div className="inline-flex rounded border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-300">Research workspace</div>
          <h1 className="mt-3 max-w-xl text-3xl font-black leading-tight tracking-tight text-white">Stocks, F&O, and crypto evidence in one read-only terminal.</h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-slate-400">Use FYERS for Indian market data, Binance public endpoints for crypto, and local deterministic indicators. Analytical signals cannot place or stage orders.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">{[["Mode", "View only"], ["AI", "Explicit only"], ["Backend", backendStatus]].map(([label, value]) => <div key={label} className="terminal-surface rounded-lg p-3"><div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</div><div className="mt-1 font-mono text-sm font-bold text-slate-100">{value}</div></div>)}</div>
        </section>

        <section className="p-8">
          <div className="mb-5 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs"><span className={`h-2 w-2 rounded-full ${health.data?.ok ? "bg-emerald-400" : "bg-rose-500"}`} /><span className="text-slate-400">Backend</span><span className="ml-auto font-medium">{backendStatus}</span></div>
          <h2 className="mb-1 text-xl font-bold text-white">Sign in with FYERS</h2>
          <p className="mb-6 text-sm leading-6 text-slate-400">The server validates the OAuth callback, exchanges the one-time authorization code, and stores the broker token encrypted. Your browser receives only a signed application session.</p>
          <button onClick={startOAuth} disabled={busy} className="group flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-500 disabled:opacity-50"><ShieldCheck className="h-4 w-4" />{busy ? "Completing secure login…" : "Continue with FYERS"}<ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" /></button>
          {busy && <div className="mt-4 text-center text-xs text-slate-400">Consuming the one-use login handoff…</div>}
          {err && <div className="mt-4 flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300"><WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{err}</span></div>}
          <div className="mt-6 rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-[11px] leading-5 text-slate-500">Authorization codes are never accepted by the browser UI and are not written to logs. Login handoffs expire after 60 seconds and can be used only once.</div>
        </section>
      </div>
    </div>
  );
}