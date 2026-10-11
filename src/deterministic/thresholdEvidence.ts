/**
 * Threshold heart rate from what the athlete has actually SUSTAINED — honestly.
 *
 * The zones derive threshold from a fixed share of max HR (88%). That is a population
 * rule, not a measurement. Other apps "fix" this by re-estimating from the latest hard
 * run and announcing "your threshold pace improved — you're stronger". From one run,
 * that is false twice over: a single session is noise, and a first measurement at an
 * intensity the model had never seen is not an improvement, it is just the first
 * measurement. (One such app set threshold HR to 168 after a tempo run whose average
 * HR was — to the beat — 168, warm-up kilometre included.)
 *
 * What a sustained effort genuinely supports is a LOWER BOUND. Above lactate
 * threshold, heart rate drifts upward and the effort cannot be held for long; so
 * holding HR steady (low drift) for 20 minutes at H is evidence that threshold is at
 * least about H. This mirrors the field protocol of taking threshold from the last 20
 * minutes of a 30-minute maximal time trial — except that a sub-maximal tempo only
 * shows "at least", never "exactly". So the wording says "at least", and the bound can
 * only ever RAISE the percentage estimate, never lower it.
 *
 * The evidence bar: TWO qualifying efforts, and the bound is the one both cleared. One
 * effort is reported but changes nothing — a strap glitch or a cadence-lock on a single
 * run must not move every zone in the app.
 */

import { THRESHOLD_PCT } from "./zones.js";

/** Length of the steady window, matching the field protocol's 20 minutes. */
export const STEADY_WINDOW_S = 20 * 60;
/** Max upward drift (second half vs first half). More than this = above threshold. */
export const MAX_DRIFT = 0.05;
/** Share of the window that must sit above the easy ceiling to count as a hard effort. */
export const MIN_ABOVE_EASY_SHARE = 0.9;
/** Efforts needed before the bound is allowed to move the zones. */
export const MIN_EFFORTS_TO_UPDATE = 2;
const MAX_SAMPLE_GAP_S = 30;

export interface EffortStream {
  timeS: number[];
  distanceM: number[];
  heartrate: (number | null)[];
}

export interface SteadyEffort {
  activityId?: number;
  date?: string;
  durationS: number;
  avgHr: number;
  /** Pace over the window, from the device's own distance. */
  paceSecPerKm: number | null;
  /** (second-half avg − first-half avg) / first-half avg. */
  drift: number;
  /** Window position in the stream, so callers can inspect what happened inside it. */
  startIndex?: number;
  endIndex?: number;
  /** Net elevation change across the window (m), when the loader had altitude. */
  netElevationM?: number;
}

/**
 * The hardest steady 20-minute window in one run, or null if the run has none.
 * Windows are scored by average HR; a window qualifies only if nearly all of it sat
 * above the easy ceiling AND its heart rate did not drift.
 */
export function findSteadyEffort(stream: EffortStream, easyCeiling: number): SteadyEffort | null {
  const { timeS: t, distanceM: d, heartrate: h } = stream;
  const n = Math.min(t.length, d.length, h.length);
  if (n < 2) return null;

  // Prefix sums of time-weighted HR, measured time, and time above the easy ceiling.
  const pt = new Float64Array(n);
  const phr = new Float64Array(n);
  const pabove = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const dt = t[i]! - t[i - 1]!;
    const hr = h[i];
    const ok = dt > 0 && dt <= MAX_SAMPLE_GAP_S && hr != null && hr > 0;
    pt[i] = pt[i - 1]! + (ok ? dt : 0);
    phr[i] = phr[i - 1]! + (ok ? hr! * dt : 0);
    pabove[i] = pabove[i - 1]! + (ok && hr! > easyCeiling ? dt : 0);
  }
  const avg = (a: number, b: number) => {
    const time = pt[b]! - pt[a]!;
    return time > 0 ? (phr[b]! - phr[a]!) / time : 0;
  };

  let best: SteadyEffort | null = null;
  let end = 0;
  let mid = 0;
  for (let start = 0; start < n; start++) {
    if (end < start) end = start;
    while (end < n - 1 && t[end]! - t[start]! < STEADY_WINDOW_S) end++;
    if (t[end]! - t[start]! < STEADY_WINDOW_S) break;
    if (mid < start) mid = start;
    while (mid < end && t[mid]! - t[start]! < STEADY_WINDOW_S / 2) mid++;

    const measured = pt[end]! - pt[start]!;
    if (measured < STEADY_WINDOW_S * 0.9) continue; // too many gaps to trust
    if ((pabove[end]! - pabove[start]!) / measured < MIN_ABOVE_EASY_SHARE) continue;
    const first = avg(start, mid);
    const second = avg(mid, end);
    if (!(first > 0) || (second - first) / first > MAX_DRIFT) continue;

    const avgHr = avg(start, end);
    if (best == null || avgHr > best.avgHr) {
      const meters = d[end]! - d[start]!;
      best = {
        durationS: t[end]! - t[start]!,
        avgHr,
        paceSecPerKm: meters > 0 ? (t[end]! - t[start]!) / (meters / 1000) : null,
        drift: (second - first) / first,
        startIndex: start,
        endIndex: end,
      };
    }
  }
  return best;
}

export interface ThresholdEstimate {
  thresholdHr: number;
  source: "percent" | "measured";
  /** Percentage-of-max estimate, always reported for comparison. */
  percentHr: number;
  /** Floor both qualifying efforts cleared; null until the evidence bar is met. */
  lowerBound: number | null;
  /** Qualifying efforts, hardest first. */
  efforts: SteadyEffort[];
  effortsNeeded: number;
}

/**
 * Combine the percentage rule with sustained-effort evidence. The bound can only raise
 * the estimate: an effort held BELOW the percentage threshold is consistent with it and
 * says nothing new, while one held ABOVE it proves the rule too low for this athlete.
 */
export function estimateThreshold(hrMax: number, efforts: SteadyEffort[]): ThresholdEstimate {
  const percentHr = Math.round(hrMax * THRESHOLD_PCT);
  const sorted = [...efforts].sort((a, b) => b.avgHr - a.avgHr);
  const lowerBound =
    sorted.length >= MIN_EFFORTS_TO_UPDATE ? Math.floor(sorted[MIN_EFFORTS_TO_UPDATE - 1]!.avgHr) : null;
  const measured = lowerBound != null && lowerBound > percentHr;
  return {
    thresholdHr: measured ? lowerBound : percentHr,
    source: measured ? "measured" : "percent",
    percentHr,
    lowerBound,
    efforts: sorted,
    effortsNeeded: Math.max(0, MIN_EFFORTS_TO_UPDATE - sorted.length),
  };
}
