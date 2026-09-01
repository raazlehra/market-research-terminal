export type StrategyLeg = {
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  premium: number;
  strike: number;
  type: "CE" | "PE";
};

export const STRATEGIES = [
  { v: "LONG_STRANGLE", label: "Long Strangle", desc: "Defined-risk volatility buy with loss capped to net premium." },
  { v: "LONG_STRADDLE", label: "Long Straddle", desc: "Defined-risk ATM volatility buy." },
  { v: "LONG_CALL", label: "Long Call", desc: "Simple bullish option buy with capped premium risk." },
  { v: "LONG_PUT", label: "Long Put", desc: "Simple bearish option buy with capped premium risk." },
  { v: "BULL_CALL_SPREAD", label: "Bull Call Spread", desc: "Lower-cost bullish debit spread with capped loss and capped profit." },
  { v: "BEAR_PUT_SPREAD", label: "Bear Put Spread", desc: "Lower-cost bearish debit spread with capped loss and capped profit." },
  { v: "CALL_BACKSPREAD", label: "Call Backspread", desc: "Defined-risk upside expansion setup." },
  { v: "PUT_BACKSPREAD", label: "Put Backspread", desc: "Defined-risk downside expansion setup." },
  { v: "CUSTOM", label: "Custom Defined Risk", desc: "Custom paper strategy. Avoid uncovered shorts." },
];

export const INDEX_SYMBOLS: Record<string, string> = {
  NIFTY: "NSE:NIFTY50-INDEX",
  BANKNIFTY: "NSE:NIFTYBANK-INDEX",
  FINNIFTY: "NSE:FINNIFTY-INDEX",
  MIDCPNIFTY: "NSE:MIDCPNIFTY-INDEX",
  SENSEX: "BSE:SENSEX-INDEX",
};

export function buildStrategySymbol(underlying: string, strike: number, type: "CE" | "PE") {
  return `${underlying}${strike}${type}`;
}

export function makeStrategyLeg(
  underlying: string,
  side: "BUY" | "SELL",
  qty: number,
  strike: number,
  type: "CE" | "PE",
  premium: number
): StrategyLeg {
  return { symbol: buildStrategySymbol(underlying, strike, type), side, qty, strike, type, premium };
}

export function hasUncoveredShort(legs: StrategyLeg[]) {
  return legs.some((shortLeg) => {
    if (shortLeg.side !== "SELL") return false;
    const protectiveQty = legs
      .filter((leg) =>
        leg.side === "BUY" &&
        leg.type === shortLeg.type &&
        (shortLeg.type === "CE" ? leg.strike > shortLeg.strike : leg.strike < shortLeg.strike)
      )
      .reduce((sum, leg) => sum + leg.qty, 0);
    return protectiveQty < shortLeg.qty;
  });
}

export function payoffPoints(legs: StrategyLeg[], spot: number) {
  const points: { spot: number; pnl: number }[] = [];
  const lo = spot - spot * 0.08;
  const hi = spot + spot * 0.08;
  const step = Math.max(1, spot * 0.001);

  for (let p = lo; p <= hi; p += step) {
    let pnl = 0;
    for (const leg of legs) {
      const intrinsic = leg.type === "CE" ? Math.max(0, p - leg.strike) : Math.max(0, leg.strike - p);
      pnl += leg.side === "BUY"
        ? (intrinsic - leg.premium) * leg.qty
        : (leg.premium - intrinsic) * leg.qty;
    }
    points.push({ spot: Math.round(p), pnl: Math.round(pnl) });
  }

  return points;
}
