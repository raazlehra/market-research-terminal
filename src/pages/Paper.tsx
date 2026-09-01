import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  usePaperBalance,
  usePaperExit,
  usePaperOrders,
  usePaperOutcomeSummary,
  usePaperPositions,
  usePaperTrades,
} from "../hooks";
import { api } from "../lib/api";
import { buildPaperWalletSummary, openPaperPositions, selectedOutcomeBucket } from "../lib/paperWalletModel";
import { useMarket, useTicket } from "../stores";
import { ConfidenceBucketsPanel } from "./paper/ConfidenceBucketsPanel";
import { PaperActivityTables } from "./paper/PaperActivityTables";
import { PaperPositionsPanel } from "./paper/PaperPositionsPanel";
import { PaperSummaryCards } from "./paper/PaperSummaryCards";

export default function Paper() {
  const bal = usePaperBalance({ refetchInterval: 2000 });
  const ords = usePaperOrders({ refetchInterval: 3000 });
  const trds = usePaperTrades({ refetchInterval: 3000 });
  const poss = usePaperPositions({ refetchInterval: 2000 });
  const outcomeSummary = usePaperOutcomeSummary({ refetchInterval: 5000 });
  const exitMutation = usePaperExit();
  const qc = useQueryClient();
  const openTicket = useTicket((s) => s.openFor);
  const marketOpen = useMarket((s) => s.marketOpen);
  const [exitLotsMap, setExitLotsMap] = useState<Record<string, number>>({});
  const [selectedBucketLabel, setSelectedBucketLabel] = useState("50-60");

  const reset = useMutation({
    mutationFn: api.paperReset,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["paperBalance"] });
      qc.invalidateQueries({ queryKey: ["paperPositions"] });
      qc.invalidateQueries({ queryKey: ["paperOrders"] });
      qc.invalidateQueries({ queryKey: ["paperTrades"] });
      qc.invalidateQueries({ queryKey: ["paperOutcomeSummary"] });
      qc.invalidateQueries({ queryKey: ["reports"] });
    },
  });

  const summary = buildPaperWalletSummary(bal.data);
  const orders: any[] = Array.isArray(ords.data) ? ords.data : [];
  const trades: any[] = Array.isArray(trds.data) ? trds.data : [];
  const positions = openPaperPositions(Array.isArray(poss.data) ? poss.data : []);
  const outcomeSummaryData = outcomeSummary.data && !Array.isArray(outcomeSummary.data)
    ? outcomeSummary.data
    : { totals: { trades: 0, netPnl: 0, winRate: 0 }, buckets: [] };
  const paperError = [bal.error, ords.error, trds.error, poss.error, outcomeSummary.error]
    .find((error): error is Error => error instanceof Error);
  const { buckets, selectedBucket, selectedLabel } = selectedOutcomeBucket(outcomeSummaryData, selectedBucketLabel);

  function openNewTradeTicket() {
    openTicket({
      symbol: "NSE:NIFTY50-INDEX",
      side: "BUY",
      orderType: "MARKET",
    });
  }

  return (
    <div className="p-5 animate-in fade-in duration-200">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Paper Trading</h1>
          <p className="text-sm text-slate-500">Simulated fills using <span className="text-indigo-300">real live prices</span> from Fyers</p>
        </div>
        <button
          onClick={() => reset.mutate()}
          disabled={reset.isPending}
          className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-1.5 text-xs font-bold hover:bg-slate-800 disabled:opacity-50"
          aria-label="Reset paper account"
          title="Reset paper account to initial state"
        >
          <RefreshCw className="mr-1 inline h-3.5 w-3.5" />Reset Paper Account
        </button>
      </div>

      <PaperSummaryCards summary={summary} />

      {paperError && (
        <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          Paper wallet data issue: {paperError.message}
        </div>
      )}

      <div className="mb-3 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3 text-xs text-indigo-300 leading-relaxed">
        <b>How it works:</b> Paper mode pulls <i>live</i> bid/ask from Fyers via the backend proxy. Orders fill at live market prices with realistic brokerage (INR 20/order + charges). No capital at risk, but the price action is real.
      </div>

      <ConfidenceBucketsPanel
        outcomeSummaryData={outcomeSummaryData}
        buckets={buckets}
        selectedBucket={selectedBucket}
        selectedLabel={selectedLabel}
        onSelectBucket={setSelectedBucketLabel}
      />

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PaperPositionsPanel
          positions={positions}
          exitLotsMap={exitLotsMap}
          setExitLotsMap={setExitLotsMap}
          exitMutation={exitMutation}
          marketOpen={marketOpen}
          onNewTrade={openNewTradeTicket}
        />
        <PaperActivityTables trades={trades} orders={[]} showOrders={false} />
      </div>

      <PaperActivityTables trades={[]} orders={orders} showTrades={false} />
    </div>
  );
}
