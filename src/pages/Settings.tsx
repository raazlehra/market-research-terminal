import { useEffect, useState } from "react";
import { useSettings } from "../stores";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Settings as SettingsIcon, Shield, Bell, Palette, Power } from "lucide-react";
import { cn } from "../lib/utils";

export default function Settings() {
  const s = useSettings();
  const qc = useQueryClient();
  const saveM = useMutation({
    mutationFn: (payload: any) => api.saveSettings(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
  const killM = useMutation({
    mutationFn: (payload: any) => api.killSwitch(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  const [form, setForm] = useState(s);
  useEffect(() => setForm(s), [s]);

  return (
    <div className="mx-auto max-w-4xl p-5 animate-in fade-in duration-200">
      <div className="mb-6">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <SettingsIcon className="h-5 w-5 text-indigo-400" /> Settings & Preferences
        </h1>
        <p className="text-sm text-slate-500">Broker config, risk rules, execution presets</p>
      </div>

      <Section icon={Shield} title="Risk Management Engine">
        <Row label="Max Daily Loss Limit (₹)">
          <input type="number" value={form.riskMaxDailyLoss} onChange={(e) => setForm({ ...form, riskMaxDailyLoss: +e.target.value })} className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-indigo-500" />
        </Row>
        <Row label="Max Trades Allowed / Day">
          <input type="number" value={form.riskMaxTrades} onChange={(e) => setForm({ ...form, riskMaxTrades: +e.target.value })} className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-indigo-500" />
        </Row>
        <Row label="Max Exposure / Trade (₹)">
          <input type="number" value={form.riskMaxExposure} onChange={(e) => setForm({ ...form, riskMaxExposure: +e.target.value })} className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-indigo-500" />
        </Row>
        <Row label="Emergency Kill Switch">
          <button
            onClick={() => { s.toggleKillSwitch(); killM.mutate(!form.killSwitch); setForm({ ...form, killSwitch: !form.killSwitch }); }}
            className={cn("flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition", form.killSwitch ? "bg-rose-600 text-white" : "bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800")}
          >
            <Power className="h-4 w-4" />{form.killSwitch ? "ACTIVE — Trading Disabled" : "INACTIVE — Orders Allowed"}
          </button>
        </Row>
      </Section>

      <Section icon={SettingsIcon} title="Default Order Preferences">
        <Row label="Default Quantity (Shares / Lots)">
          <input type="number" value={form.defaultQty} onChange={(e) => setForm({ ...form, defaultQty: +e.target.value })} className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none focus:border-indigo-500" />
        </Row>
        <Row label="Product Type">
          <select value={form.defaultProduct} onChange={(e) => setForm({ ...form, defaultProduct: e.target.value as any })} className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none">
            <option>INTRADAY</option><option>MARGIN</option>
          </select>
        </Row>
        <Row label="Exchange">
          <select value={form.defaultExchange} onChange={(e) => setForm({ ...form, defaultExchange: e.target.value as any })} className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none">
            <option>NSE</option><option>BSE</option>
          </select>
        </Row>
        <Row label="Validity">
          <select value={form.defaultValidity} onChange={(e) => setForm({ ...form, defaultValidity: e.target.value as any })} className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-white outline-none">
            <option>DAY</option><option>IOC</option>
          </select>
        </Row>
      </Section>

      <Section icon={Bell} title="Notifications">
        <Row label="Sound Alerts (Order Fills & Bot Triggers)">
          <Toggle value={form.soundAlerts} onChange={(v) => setForm({ ...form, soundAlerts: v })} />
        </Row>
        <Row label="Desktop Browser Notifications">
          <Toggle value={form.desktopNotifications} onChange={(v) => setForm({ ...form, desktopNotifications: v })} />
        </Row>
      </Section>

      <Section icon={Palette} title="Backend Connection">
        <Row label="Backend API Proxy URL">
          <input value={form.apiUrl} onChange={(e) => setForm({ ...form, apiUrl: e.target.value })} className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-white outline-none" />
        </Row>
        <p className="text-[11px] text-slate-500">This is where the React app sends all Fyers proxy requests. Must match the backend <code className="rounded bg-slate-800 px-1">.env</code> CORS origin.</p>
      </Section>

      <div className="mt-6 flex justify-end">
        <button onClick={() => { s.update(form); saveM.mutate(form); }} disabled={saveM.isPending} className="rounded-lg bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow hover:bg-indigo-500 disabled:opacity-50">
          {saveM.isPending ? "Saving configuration…" : "Save All Settings"}
        </button>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, children }: any) {
  return (
    <div className="mb-5 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-300">
        <Icon className="h-4 w-4 text-indigo-400" />{title}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
function Row({ label, children }: any) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-3 md:items-center">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="md:col-span-2">{children}</div>
    </div>
  );
}
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} className={cn("relative h-6 w-11 rounded-full transition", value ? "bg-indigo-600" : "bg-slate-800")}>
      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white transition", value ? "left-5" : "left-0.5")} />
    </button>
  );
}
