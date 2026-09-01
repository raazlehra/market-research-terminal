import { create } from "zustand";
import { getLotSizeFromSymbol } from "../lib/utils";
import { useSettings } from "./settingsStore";

export interface TicketParams {
  symbol: string;
  side: "BUY" | "SELL";
  qty?: number;
  orderType?: "MARKET" | "LIMIT";
  product?: string;
  exchange?: string;
  validity?: string;
  price?: number;
  lotSize?: number;
  optionType?: "CE" | "PE";
  mode?: "real" | "paper";
  confidence?: number;
  strategy?: string;
  targets?: number[];
  sl?: number;
  trailSl?: boolean;
}

interface TicketState {
  isOpen: boolean;
  params: TicketParams;
  openFor: (p: TicketParams) => void;
  close: () => void;
}

export const useTicket = create<TicketState>((set) => ({
  isOpen: false,
  params: {
    symbol: "",
    side: "BUY",
    qty: 1,
    orderType: "MARKET",
    product: "INTRADAY",
    price: 0,
    lotSize: 1,
    mode: "paper",
    confidence: 85,
    targets: [],
    sl: 0,
    trailSl: true
  },
  openFor: (p) => {
    console.log("useTicket.openFor called", p);
    const settings = useSettings.getState();
    const fallbackQty = Math.max(1, Number(settings.defaultQty || 1));
    set({
      isOpen: true,
      params: {
        symbol: p.symbol,
        side: p.side,
        qty: p.qty || fallbackQty,
        orderType: p.orderType || "MARKET",
        product: p.product || settings.defaultProduct || "INTRADAY",
        exchange: p.exchange || settings.defaultExchange || "NSE",
        validity: p.validity || settings.defaultValidity || "DAY",
        price: p.price || 0,
        lotSize: p.lotSize || getLotSizeFromSymbol(p.symbol),
        optionType: p.optionType,
        mode: "paper",
        confidence: p.confidence || 85,
        targets: p.targets || (p.price ? [parseFloat((p.price * 1.02).toFixed(2)), parseFloat((p.price * 1.05).toFixed(2))] : []),
        sl: p.sl || (p.price ? parseFloat((p.price * 0.97).toFixed(2)) : 0),
        trailSl: p.trailSl ?? true
      },
    });
  },
  close: () => set({ isOpen: false }),
}));
