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

/**
 * How far above the bridge's clamp CTL must sit before the bridge is meaningfully
 * unsaturated. At CTL 5.1 against a floor of 5 the ratio is still pinned — the estimate
 * is the same over-optimistic extrapolation the floor exists to suppress, and only a
 * strict `<=` let it through.
 */
export const RELIABILITY_CTL_MARGIN = 1.5;

/**
 * Distance extrapolation beyond which a race estimate is not supportable.
 *
 * Riegel-type extrapolation degrades quickly outside roughly a two-to-three-fold jump:
 * predicting a half marathon from a 5 km longest run is guessing at endurance the athlete
 * has not demonstrated at any distance this season. At 3x, a 21.1 km race requires a
 * ~7 km longest run before a number is shown — a low bar that still rules out the
 * "4x extrapolation off a 5 km run" case.
 */
export const RELIABILITY_MAX_EXTRAPOLATION = 3;

export interface ReliabilityInput {
  /** Current running CTL (fitness_state), the true un-floored value. Null if unknown. */
  runningCtl: number | null;
  runs28d: number;
  daysSinceLastRun: number | null;
  /** Longest run in the recent window, metres. Null when unknown (check is skipped). */
  longestRecentRunM?: number | null;
  /** Target race distance, metres. Null when unknown (check is skipped). */
  raceDistanceM?: number | null;
}

export interface Reliability {
  reliable: boolean;
  reason: string;
}

export function estimateReliability(x: ReliabilityInput): Reliability {
  if (x.runningCtl != null && x.runningCtl <= RELIABILITY_CTL_FLOOR + RELIABILITY_CTL_MARGIN) {
    return {
      reliable: false,
      reason: `running fitness is still near zero (CTL ${x.runningCtl.toFixed(1)}) — an estimate would extrapolate from an old race, not current shape`,
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
  if (x.longestRecentRunM != null && x.raceDistanceM != null && x.longestRecentRunM > 0) {
    const factor = x.raceDistanceM / x.longestRecentRunM;
    if (factor > RELIABILITY_MAX_EXTRAPOLATION) {
      return {
        reliable: false,
        reason:
          `your longest recent run is ${(x.longestRecentRunM / 1000).toFixed(1)}km — estimating ` +
          `${(x.raceDistanceM / 1000).toFixed(1)}km from that extrapolates ${factor.toFixed(1)}x, ` +
          `well past where the model holds`,
      };
    }
  }
  return { reliable: true, reason: "recent running provides a current-shape anchor" };
}
