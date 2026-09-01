import { create } from "zustand";

interface WatchlistState {
  symbols: string[];
  add: (sym: string) => void;
  remove: (sym: string) => void;
}

export const useWatchlist = create<WatchlistState>((set, get) => ({
  symbols: JSON.parse(localStorage.getItem("fyers_v3_watchlist") || '["NSE:RELIANCE-EQ", "NSE:HDFCBANK-EQ", "NSE:INFY-EQ", "NSE:NIFTY50-INDEX"]') as string[],
  add: (sym) => {
    const s = get().symbols;
    if (s.includes(sym)) return;
    const next = [...s, sym];
    localStorage.setItem("fyers_v3_watchlist", JSON.stringify(next));
    set({ symbols: next });
  },
  remove: (sym) => {
    const next = get().symbols.filter((x) => x !== sym);
    localStorage.setItem("fyers_v3_watchlist", JSON.stringify(next));
    set({ symbols: next });
  },
}));
