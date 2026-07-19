/**
 * Heart-rate training zones. Source: Daniels' Running Formula — the Easy/aerobic
 * zone is 65–79% of maximum heart rate; threshold sits around 88–92% HRmax.
 *
 * Why this module exists: pace prescriptions derived from a peak-fitness VDOT are
 * wrong for a detrained athlete (the same pace costs far more effort). Heart rate is
 * self-normalizing — 74% of max is easy whether you're peak-fit or rebuilding — so
 * easy sessions are prescribed by HR ceiling, with pace as a secondary reference.
 */

export interface HrProfile {
  hrMax: number;
  hrRest: number;
}

export interface HrZones {
  /** Bottom of the easy/aerobic band (65% HRmax). */
  easyFloor: number;
  /** Top of the easy/aerobic band (79% HRmax) — do not exceed on an easy run. */
  easyCeiling: number;
  /** Approximate threshold HR (88% HRmax). */
  threshold: number;
}

export const EASY_FLOOR_PCT = 0.65;
export const EASY_CEILING_PCT = 0.79;
export const THRESHOLD_PCT = 0.88;

export function hrZones(p: HrProfile): HrZones {
  return {
    easyFloor: Math.round(p.hrMax * EASY_FLOOR_PCT),
    easyCeiling: Math.round(p.hrMax * EASY_CEILING_PCT),
    threshold: Math.round(p.hrMax * THRESHOLD_PCT),
  };
}

/**
 * Median of a numeric list. Used for observed-pace estimation, where a median is
 * the right choice over a mean — one mis-recorded GPS run shouldn't move the
 * prescribed easy pace.
 */
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
