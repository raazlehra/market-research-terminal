import { create } from "zustand";
import { getMarketStatus } from "../lib/utils";

interface MarketState {
  ticks: Record<string, any>;
  marketOpen: boolean;
  marketStatus: string;
}

export const useMarket = create<MarketState>((set) => {
  // Listen to the native custom event broadcast by the socket manager
  if (typeof window !== "undefined") {
    window.addEventListener("fyers_ticks", (e: any) => {
      const detail = e.detail || {};
      if (detail.type === "tick" && detail.payload) {
        const p = detail.payload;
        if (p.symbol) {
          set((s) => ({ ticks: { ...s.ticks, [p.symbol]: p } }));
        }
      } else {
        set((s) => ({ ticks: { ...s.ticks, ...detail } }));
      }
    });
  }
  const marketStatus = getMarketStatus();

  if (typeof window !== "undefined") {
    const updateMarketStatus = () => {
      const status = getMarketStatus();
      set({ marketOpen: status.isOpen, marketStatus: status.reason });
    };
    window.setInterval(updateMarketStatus, 30000);
  }

  return {
    ticks: {},
    marketOpen: marketStatus.isOpen,
    marketStatus: marketStatus.reason,
  };
});
