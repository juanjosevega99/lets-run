/**
 * When is a current-shape race estimate trustworthy enough to show as a number?
 *
 * The vdot-ctl predictor bridges a past race to today via the running-CTL ratio and
 * clamps CTL at a floor of 5 to avoid ratio blow-ups. Below that floor the bridge is
 * SATURATED: it cannot distinguish "detrained" from "completely detrained", so it
 * quietly extrapolates from an old best-ever race and reports an over-optimistic time
 * (e.g. a 1:48 half for someone who has not run in months). When there is essentially
 * no recent running to anchor current shape, we show an honest qualitative message
 * instead of a false-precise time — the "numbers you can stand behind" rule.
 *
 * This gates DISPLAY only. The raw estimate is still stored (for the record and the
 * backtest); it is just not presented as a confident headline. The real accuracy fix
 * is P1 (docs/p1-forecast-implementation.md); this is the honest interim.
 */

export const RELIABILITY_CTL_FLOOR = 5; // the exact clamp in vdot-ctl-v1's bridge
export const RELIABILITY_MAX_GAP_DAYS = 28;

export interface ReliabilityInput {
  /** Current running CTL (fitness_state), the true un-floored value. Null if unknown. */
  runningCtl: number | null;
  runs28d: number;
  daysSinceLastRun: number | null;
}

export interface Reliability {
  reliable: boolean;
  reason: string;
}

export function estimateReliability(x: ReliabilityInput): Reliability {
  if (x.runningCtl != null && x.runningCtl <= RELIABILITY_CTL_FLOOR) {
    return {
      reliable: false,
      reason: `running fitness is near zero (CTL ${x.runningCtl.toFixed(1)}) — an estimate would extrapolate from an old race, not current shape`,
    };
  }
  if (x.runs28d <= 0) {
    return { reliable: false, reason: "no runs logged in the last 28 days to anchor current shape" };
  }
  if (x.daysSinceLastRun != null && x.daysSinceLastRun > RELIABILITY_MAX_GAP_DAYS) {
    return {
      reliable: false,
      reason: `${x.daysSinceLastRun} days since your last run — too long to estimate current shape`,
    };
  }
  return { reliable: true, reason: "recent running provides a current-shape anchor" };
}
