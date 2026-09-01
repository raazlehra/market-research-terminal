import { useTicket } from "../stores";
import { isMarketOpen } from "./utils";

export type OpenOptionPayload = {
  symbol: string;
  side: "CE" | "PE";
  lotSize: number;
  price: number;
  confidence?: number;
  extra?: Record<string, any>;
};

export function openOptionFor(payload: OpenOptionPayload) {
  if (!isMarketOpen()) {
    alert("Market Closed");
    return;
  }

  useTicket.getState().openFor({
    symbol: payload.symbol,
    side: "BUY",
    qty: payload.lotSize,
    orderType: "MARKET",
    product: "INTRADAY",
    price: payload.price,
    lotSize: payload.lotSize,
    optionType: payload.side,
    confidence: Math.max(50, Math.round(payload.confidence ?? 50)),
    ...payload.extra,
  });
}
