export const SCANNERS = [
  { v: "VWAP_BREAKOUT", label: "VWAP Breakout", desc: "Price crossing VWAP with volume confirmation" },
  { v: "BREAKOUT_VOLUME", label: "Breakout Volume", desc: "Price clears range high with 2x volume" },
  { v: "BREAKOUT", label: "Range Breakout", desc: "Breaking 20-candle high with volume" },
  { v: "EMA_CROSS", label: "EMA Trend Alignment", desc: "Price above EMA20 and EMA50 with trend alignment" },
  { v: "VOLUME_SPIKE", label: "Volume Spike", desc: "Names with unusually high traded volume" },
];

export const DEFAULT_QUICK_PARAMS = { minVolume: 100000, minChange: 50 };
