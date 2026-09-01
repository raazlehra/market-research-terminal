import { formatWinRate } from "../../lib/paperWalletModel";
import { inr } from "../../lib/utils";

function MetricTile({ label, value, tone }: any) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{label}</div>
      <div className={`mt-2 font-mono text-xl font-black ${tone === "pos" ? "text-emerald-400" : tone === "neg" ? "text-rose-400" : "text-slate-100"}`}>{value ?? "0"}</div>
    </div>
  );
}

type ConfidenceBucketsPanelProps = {
  outcomeSummaryData: any;
  buckets: any[];
  selectedBucket: any;
  selectedLabel: string;
  onSelectBucket: (label: string) => void;
};

export function ConfidenceBucketsPanel({
  outcomeSummaryData,
  buckets,
  selectedBucket,
  selectedLabel,
  onSelectBucket,
}: ConfidenceBucketsPanelProps) {
  return (
    <div className="mb-4 rounded-lg border border-slate-800 bg-slate-950/60">
      <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Confidence Buckets</h3>
          <div className="mt-1 text-[11px] text-slate-500">Closed paper trades grouped by signal confidence.</div>
        </div>
        {outcomeSummaryData.totals && (
          <div className="grid grid-cols-3 gap-2 text-right text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Trades</div>
              <div className="font-mono font-bold text-slate-100">{outcomeSummaryData.totals.trades || 0}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Win Rate</div>
              <div className="font-mono font-bold text-slate-100">{formatWinRate(outcomeSummaryData.totals.winRate)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">P. Factor</div>
              <div className="font-mono font-bold text-slate-100">{(outcomeSummaryData.totals.profitFactor || 0).toFixed(2)}</div>
            </div>
          </div>
        )}
      </div>

      {buckets.length > 0 ? (
        <div className="grid gap-4 p-4 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-1">
            {buckets.map((bucket: any) => {
              const label = bucket.bucket || bucket.confidenceBucket;
              const active = label === selectedLabel;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => onSelectBucket(label)}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    active
                      ? "border-indigo-500/70 bg-indigo-500/15 text-indigo-100"
                      : "border-slate-800 bg-slate-900/50 text-slate-400 hover:border-slate-700 hover:bg-slate-900"
                  }`}
                >
                  <div className="text-xs font-bold">{label}</div>
                  <div className="mt-1 text-[11px] font-mono">{bucket.trades || 0} trades</div>
                </button>
              );
            })}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="flex flex-col gap-2 border-b border-slate-800 pb-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500">Selected Bucket</div>
                <div className="mt-1 text-2xl font-black text-white">{selectedLabel}</div>
              </div>
              <div className="text-sm text-slate-400">
                <span className="font-mono font-bold text-slate-100">{selectedBucket?.trades || 0}</span> closed trades
              </div>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <MetricTile label="Win Rate" value={formatWinRate(selectedBucket?.winRate)} />
              <MetricTile label="Avg Return" value={`${(selectedBucket?.avgReturn || 0).toFixed(2)}%`} />
              <MetricTile label="Profit Factor" value={(selectedBucket?.profitFactor || 0).toFixed(2)} />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <MetricTile label="Gross Profit" value={inr(selectedBucket?.grossProfit || 0)} tone="pos" />
              <MetricTile label="Gross Loss" value={inr(selectedBucket?.grossLoss || 0)} tone="neg" />
            </div>
          </div>
        </div>
      ) : (
        <div className="p-6 text-sm text-slate-500">
          No outcome summary data available yet. Place a few paper trades to begin validating confidence buckets.
        </div>
      )}
    </div>
  );
}
