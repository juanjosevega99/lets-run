/**
 * v1 limiter heuristic — deterministic rules over observable state, evaluated in
 * priority order. This is NOT the PRD P-A sensitivity analysis (that needs model
 * dimensions that don't exist yet — PRD §7 CRUX); it's an honest rule-based stand-in
 * that F3 uses so the plan's "what" stays deterministic. Each result carries the
 * numbers that drove it, so the decision is reproducible and explainable (PRD F-A
 * acceptance), just not derived from ∂time/∂dimension yet.
 */

export type Limiter = "aerobic_base" | "long_endurance" | "threshold" | "race_specific";

export interface LimiterInput {
  /** current running CTL and the athlete's own historical peak CTL */
  ctl: number;
  peakCtl: number;
  /** longest single run in the last 28 days (km) and the race distance (km) */
  longestRunKm28d: number;
  raceKm: number;
  /** share (0..1) of last-28-day running volume at/above threshold intensity */
  qualityShare28d: number;
}

export interface LimiterResult {
  limiter: Limiter;
  reason: string;
}

export const CTL_REBUILD_THRESHOLD = 0.6; // below 60% of own peak → base is the limiter
export const LONG_RUN_THRESHOLD = 0.6; // longest recent run < 60% of race distance
export const QUALITY_SHARE_FLOOR = 0.08; // < 8% quality volume → threshold work missing

export function findLimiter(x: LimiterInput): LimiterResult {
  if (x.peakCtl > 0 && x.ctl < CTL_REBUILD_THRESHOLD * x.peakCtl) {
    return {
      limiter: "aerobic_base",
      reason: `running CTL ${x.ctl.toFixed(1)} is ${((100 * x.ctl) / x.peakCtl).toFixed(0)}% of peak ${x.peakCtl.toFixed(1)} — rebuild volume before anything else`,
    };
  }
  if (x.raceKm > 0 && x.longestRunKm28d < LONG_RUN_THRESHOLD * x.raceKm) {
    return {
      limiter: "long_endurance",
      reason: `longest recent run ${x.longestRunKm28d.toFixed(1)}km < ${(LONG_RUN_THRESHOLD * 100).toFixed(0)}% of race distance ${x.raceKm.toFixed(1)}km`,
    };
  }
  if (x.qualityShare28d < QUALITY_SHARE_FLOOR) {
    return {
      limiter: "threshold",
      reason: `quality share ${(x.qualityShare28d * 100).toFixed(1)}% of recent volume < ${QUALITY_SHARE_FLOOR * 100}% floor`,
    };
  }
  return {
    limiter: "race_specific",
    reason: "base, long endurance and threshold all in range — sharpen race-specific fitness",
  };
}
