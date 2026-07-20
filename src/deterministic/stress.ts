/**
 * Per-activity training stress — PROJECT.md §6's explicit fallback hierarchy, so no
 * activity silently drops out of the load curve:
 *
 *   1. Strength work uses a modality-specific duration load. Heart-rate TRIMP is
 *      not used for lifting: cardiovascular response does not represent its local
 *      neuromuscular/mechanical cost.
 *   2. HR-based TRIMP for aerobic activities when average heart rate exists
 *      (Banister 1991, male weighting):
 *        TRIMP = minutes · r · 0.64 · e^(1.92·r),  r = (HRavg − HRrest)/(HRmax − HRrest)
 *   3. Pace-based stress for runs without HR (rTSS-shaped):
 *        stress = hours · (v / vThreshold)² · 100
 *      (threshold velocity from the athlete's reference VDOT at 86%)
 *   4. Flat duration rate for everything else — crude, but §6: silent holes
 *      are worse than crude estimates.
 */

import { velocityAtFraction } from "./vdot.js";

export interface AthleteHrProfile {
  hrMax: number;
  hrRest: number;
}

export interface StressInput {
  sportType: string;
  movingTimeS: number | null;
  elapsedTimeS: number | null;
  distanceM: number | null;
  avgHr: number | null;
}

/** Flat hourly rates for the final fallback, by coarse sport bucket. Estimates, documented. */
const FLAT_RATE_PER_HOUR: { match: RegExp; rate: number }[] = [
  { match: /weight|strength/i, rate: 30 },
  { match: /ride|bike|cycl/i, rate: 55 },
  { match: /swim/i, rate: 55 },
  { match: /run/i, rate: 70 }, // a run with no HR and no distance — rare but possible
];
const FLAT_RATE_DEFAULT = 40;

export function isRunning(sportType: string): boolean {
  return /run/i.test(sportType);
}

export function isStrength(sportType: string): boolean {
  return /weight|strength/i.test(sportType);
}

/** Modalities with meaningful central-aerobic transfer, while preserving specificity. */
export function isAerobic(sportType: string): boolean {
  return /run|ride|bike|cycl|swim|walk|hike/i.test(sportType);
}

export interface StressResult {
  stress: number;
  method: "trimp" | "pace" | "flat";
}

export function activityStress(
  a: StressInput,
  hr: AthleteHrProfile,
  referenceVdot: number,
): StressResult {
  // Some manually entered activities store moving_time=0 while elapsed_time is
  // valid. Nullish coalescing alone would silently erase those sessions.
  const timeS = a.movingTimeS != null && a.movingTimeS > 0 ? a.movingTimeS : a.elapsedTimeS;
  if (!timeS || timeS <= 0) return { stress: 0, method: "flat" };
  const minutes = timeS / 60;

  // Strength is intentionally classified before the HR branch. Average HR during
  // lifting is a poor proxy for local muscular load and previously inflated ATL.
  if (isStrength(a.sportType)) {
    const rate = FLAT_RATE_PER_HOUR.find((f) => f.match.test(a.sportType))?.rate ?? FLAT_RATE_DEFAULT;
    return { stress: (minutes / 60) * rate, method: "flat" };
  }

  // Aerobic HR load — TRIMP
  if (a.avgHr != null && a.avgHr > hr.hrRest) {
    const r = Math.min(1, (a.avgHr - hr.hrRest) / (hr.hrMax - hr.hrRest));
    return { stress: minutes * r * 0.64 * Math.exp(1.92 * r), method: "trimp" };
  }

  // 3 — pace-based, running with distance
  if (isRunning(a.sportType) && a.distanceM != null && a.distanceM > 0) {
    const v = a.distanceM / minutes; // m/min
    const vThreshold = velocityAtFraction(referenceVdot, 0.86);
    const intensity = Math.min(1.3, v / vThreshold); // cap: bad GPS shouldn't mint stress
    return { stress: (minutes / 60) * intensity * intensity * 100, method: "pace" };
  }

  // 4 — flat rate
  const rate = FLAT_RATE_PER_HOUR.find((f) => f.match.test(a.sportType))?.rate ?? FLAT_RATE_DEFAULT;
  return { stress: (minutes / 60) * rate, method: "flat" };
}
