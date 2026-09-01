import { useTradebook } from "../hooks";
import { inr, fmtTime, signColor } from "../lib/utils";

export default function Trades() {
  const q = useTradebook();
  const trades: any[] = q.data?.trades ?? [];

  return (
    <div className="p-5 animate-in fade-in duration-200">
      <div className="mb-4">
        <h1 className="text-xl font-bold">Trade Book</h1>
        <p className="text-sm text-slate-500">{trades.length} fills today • synced from Fyers</p>
      </div>
      <div className="overflow-auto rounded-lg border border-slate-800">
        <table className="w-full text-xs">
          <thead className="bg-slate-900 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="text-left">Order ID</th>
              <th className="text-left">Symbol</th>
              <th className="text-left">Side</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Price</th>
              <th className="text-left">Product</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 && (
              <tr><td colSpan={7} className="py-8 text-center text-slate-500">
                {q.isLoading ? "Loading trade stream…" : "No trades today."}
              </td></tr>
            )}
            {trades.map((t, i) => {
              const side = (t.side === 1 || t.transactionType === "BUY") ? "BUY" : "SELL";
              return (
                <tr key={i} className="border-t border-slate-800/60 hover:bg-slate-800/30 transition">
                  <td className="px-3 py-2 text-slate-500 font-mono">{fmtTime(t.orderDateTime ?? t.tradeDate ?? t.order_timestamp)}</td>
                  <td className="font-mono text-[11px] text-slate-400">{t.orderNumber ?? t.orderId}</td>
                  <td className="font-bold text-white">{t.symbol || t.tradingsymbol}</td>
                  <td className={signColor(side === "BUY" ? 1 : -1)}>{side}</td>
                  <td className="text-right font-mono text-slate-200">{t.tradedQty ?? t.quantity ?? t.qty}</td>
                  <td className="text-right font-mono font-bold text-slate-100">{inr(t.tradePrice ?? t.price)}</td>
                  <td><span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-slate-300">{t.productType || "INTRADAY"}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
