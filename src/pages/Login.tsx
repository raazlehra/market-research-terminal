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
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(
      (window.location.hash || "").includes("?")
        ? window.location.hash.split("?")[1]
        : "",
    );

    const c =
      searchParams.get("auth_code") ||
      searchParams.get("code") ||
      hashParams.get("auth_code") ||
      hashParams.get("code");

    if (c) {
      setCode(c);
      exchange(c);
    }
  }, []);

  useEffect(() => {
    if (token) navigate("/dashboard");
  }, [token, navigate]);

  async function startOAuth() {
    try {
      const { url } = await api.loginUrl();
      window.location.href = url;
    } catch (e: any) {
      setErr(e.message || "Failed to get login URL");
    }
  }

  async function exchange(c: string) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.exchangeCode(c);
      setToken(r.access_token, r.user);
      navigate("/dashboard");
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e.message || "Failed to exchange code");
    } finally {
      setBusy(false);
    }
  }

  const backendStatus = health.data?.ok
    ? "Online"
    : health.isLoading
      ? "Checking"
      : "Offline";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_20%_20%,rgba(22,163,74,0.16),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(37,99,235,0.14),transparent_30%),linear-gradient(135deg,#020617_0%,#07111f_48%,#020617_100%)] p-6 text-slate-100">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-xl border border-slate-700/80 bg-slate-950/80 shadow-2xl shadow-black/35 backdrop-blur-xl md:grid-cols-[1.05fr_0.95fr]">
        <section className="border-b border-slate-800 p-8 md:border-b-0 md:border-r">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-emerald-400/25 bg-emerald-500/10 shadow-[0_0_28px_rgba(22,163,74,0.18)]">
              <Radio className="h-5 w-5 text-emerald-300" />
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight text-white">FnO Terminal</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
                Fyers v3 / Indian Markets
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <div className="mb-2 inline-flex rounded border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-300">
                Execution workspace
              </div>
              <h1 className="max-w-xl text-3xl font-black leading-tight tracking-tight text-white">
                A focused command center for paper and Fyers-assisted FnO trading.
              </h1>
              <p className="mt-3 max-w-lg text-sm leading-6 text-slate-400">
                Sign in to monitor live market health, manage risk controls, and stage orders from one dense trading workspace.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["Mode", "Paper / Live"],
                ["Risk", "Guarded"],
                ["Data", backendStatus],
              ].map(([label, value]) => (
                <div key={label} className="terminal-surface rounded-lg p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
                  <div className="mt-1 font-mono text-sm font-bold text-slate-100">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="p-8">
          <div className="mb-5 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs">
            <span
              className={`h-2 w-2 rounded-full ${
                health.data?.ok ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" : "bg-rose-500"
              }`}
            />
            <span className="text-slate-400">Backend</span>
            <span className="ml-auto font-medium">{backendStatus}</span>
          </div>

          <h2 className="mb-1 text-xl font-bold text-white">Sign in with Fyers</h2>
          <p className="mb-6 text-sm leading-6 text-slate-400">
            Fyers OAuth handles credentials. The local app stores the access token and forwards it to the backend proxy.
          </p>

          <button
            onClick={startOAuth}
            disabled={busy}
            className="group flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white shadow-lg shadow-emerald-950/30 transition hover:bg-emerald-500 disabled:opacity-50"
          >
            <ShieldCheck className="h-4 w-4" />
            Continue with Fyers
            <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </button>

          {code && !busy && (
            <div className="mt-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
              Auth code received. Signing you in...
            </div>
          )}

          {busy && <div className="mt-4 text-center text-xs text-slate-400">Exchanging auth code...</div>}

          {err && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{err}</span>
            </div>
          )}

          <div className="mt-6 rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-[11px] text-slate-500">
            <div className="mb-1 font-semibold text-slate-400">Manual auth code</div>
            <p className="mb-2">If your redirect did not fire, paste the auth_code from the Fyers callback URL:</p>
            <div className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="auth_code=..."
                className="min-h-9 flex-1 rounded bg-slate-900 px-2 py-1.5 text-slate-200 outline-none"
              />
              <button
                onClick={() => exchange(code)}
                disabled={!code || busy}
                className="min-h-9 rounded bg-slate-700 px-3 py-1.5 font-bold text-slate-200 hover:bg-slate-600 disabled:opacity-50"
              >
                Submit
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
