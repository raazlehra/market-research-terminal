export interface ConfidenceFactors {
  trendAlignment: number; // 0-15: Spot vs VWAP/EMA alignment (reduced from 25)
  greeksFavor: number; // 0-10: Delta positioning only (reduced from 20, removed gamma/theta)
  ivExtreme: number; // 0-15: current-chain-relative IV rank, not historical IV rank
  volumeCluster: number; // 0-15: Volume and OI patterns (unchanged)
  writerUnwind: number; // 0-8: Writer positioning and exits (reduced from 15)
  liquidity: number; // 0-10: bid/ask spread, volume, OI liquidity (unchanged)
  trendConfluence: number; // 0-8: multitimeframe trend agreement (reduced from 15)
  // NOTE: strikeCluster was removed — it overlapped with volumeCluster (both measure OI concentration)
}

export type RuleScoreDirection = "bullish" | "bearish" | "neutral";

export interface ScoreBreakdownItem {
  component: string;
  rawValue: number | string | null;
  normalizedValue: number;
  weight: number;
  pointsContributed: number;
  direction: RuleScoreDirection;
  missingData: boolean;
  reason: string;
}

export interface ConfidenceResult {
  score: number; // 0-100 uncalibrated rule-based confluence score
  scoreType: "rule_based_confluence";
  calibrated: false;
  scoreRange: [0, 100];
  factors: ConfidenceFactors;
  scoreBreakdown: ScoreBreakdownItem[];
  signal: string;
  strength: "WEAK" | "MODERATE" | "STRONG" | "VERY_STRONG";
  writerEvent?: string | null; // Display-only label (not used in scoring)
}
