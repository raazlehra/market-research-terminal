import { create } from "zustand";
import { DEFAULT_API_BASE_URL } from "../lib/api/config";

interface SettingsState {
  tradingMode: "paper";
  riskMaxDailyLoss: number;
  riskMaxTrades: number;
  riskMaxExposure: number;
  killSwitch: boolean;
  defaultQty: number;
  defaultProduct: string;
  defaultExchange: string;
  defaultValidity: string;
  soundAlerts: boolean;
  desktopNotifications: boolean;
  apiUrl: string;
  setTradingMode: (mode?: "real" | "paper") => void;
  toggleKillSwitch: () => void;
  update: (patch: Partial<SettingsState>) => void;
}

function readSavedSettings() {
  try {
    return JSON.parse(localStorage.getItem("fyers_v3_settings") || "{}");
  } catch {
    return {};
  }
}

function persistSettings(s: SettingsState) {
  const {
    riskMaxDailyLoss,
    riskMaxTrades,
    riskMaxExposure,
    defaultQty,
    defaultProduct,
    defaultExchange,
    defaultValidity,
    soundAlerts,
    desktopNotifications,
    apiUrl,
  } = s;
  localStorage.setItem("fyers_v3_settings", JSON.stringify({
    tradingMode: "paper",
    riskMaxDailyLoss,
    riskMaxTrades,
    riskMaxExposure,
    defaultQty,
    defaultProduct,
    defaultExchange,
    defaultValidity,
    soundAlerts,
    desktopNotifications,
    apiUrl,
  }));
}

const savedSettings = readSavedSettings();

export const useSettings = create<SettingsState>((set) => ({
  tradingMode: "paper",
  riskMaxDailyLoss: savedSettings.riskMaxDailyLoss || 5000,
  riskMaxTrades: savedSettings.riskMaxTrades || 10,
  riskMaxExposure: savedSettings.riskMaxExposure || 200000,
  killSwitch: localStorage.getItem("fyers_v3_killswitch") === "true",
  defaultQty: savedSettings.defaultQty || 25,
  defaultProduct: savedSettings.defaultProduct || "INTRADAY",
  defaultExchange: savedSettings.defaultExchange || "NSE",
  defaultValidity: savedSettings.defaultValidity || "DAY",
  soundAlerts: savedSettings.soundAlerts ?? true,
  desktopNotifications: savedSettings.desktopNotifications ?? false,
  apiUrl: savedSettings.apiUrl || DEFAULT_API_BASE_URL,
  setTradingMode: () => {
    set((s) => {
      const next = { ...s, tradingMode: "paper" as const };
      persistSettings(next);
      return { tradingMode: "paper" };
    });
  },
  toggleKillSwitch: () => {
    set((s) => {
      const next = !s.killSwitch;
      localStorage.setItem("fyers_v3_killswitch", next ? "true" : "false");
      return { killSwitch: next };
    });
  },
  update: (patch) => {
    set((s) => {
      const safePatch: Partial<SettingsState> = { ...patch };
      safePatch.tradingMode = "paper";
      const next = { ...s, ...safePatch };
      if (typeof patch.killSwitch === "boolean") {
        localStorage.setItem("fyers_v3_killswitch", patch.killSwitch ? "true" : "false");
      }
      persistSettings(next);
      return next;
    });
  },
}));
