/**
 * A current-shape estimate from what the athlete has actually done RECENTLY — not from
 * his best race four years ago.
 *
 * The existing model anchors on the best race available. With no race in two years it
 * falls back to the best ever (June 2022), discounts it by a load ratio whose exponent
 * is a guess (0.06 — halving training load costs 4%), and called the result "estimated
 * today". On 2026-10-11 that read 1:42:19 for an athlete who, ten days earlier, held
 * 5:45/km for twenty minutes and called it "not easy but possible". A 1:42 on that
 * course needs ~4:51/km for 102 minutes.
 *
 * What fresh training evidence supports is a BOUND, not a point. A steady effort whose
 * heart rate did not drift was run at or below threshold — above it, HR climbs. So the
 * athlete's threshold pace is at least as fast as the pace he held, and his VDOT at
 * least the VDOT whose threshold pace that is (Daniels). That makes a race time he
 * would run no SLOWER than. It is deliberately one-sided:
 *
 *  - it never flatters: it assumes nothing about how much harder he could have gone;
 *  - it fails safe on GPS: a watch reading short makes the pace look slower, which only
 *    loosens the bound;
 *  - it tightens on its own as harder steady efforts appear — a time trial would close
 *    it into a point.
 *
 * The fast side stays honestly open. The only fast-side evidence is old races and an
 * 11-month-old hard effort that both pre-date a seven-month layoff, so the old model's
 * number is reported as "optimistic", never as current.
 */

import { predictTimeS, trainingPaces } from "./vdot.js";
import type { SteadyEffort } from "./thresholdEvidence.js";

/**
 * A downhill window flatters pace, which would push the bound in the dangerous
 * direction (too fast). Efforts that lost more than this across the window are not used.
 */
export const MAX_NET_DESCENT_M = 15;

/** The VDOT whose Daniels threshold pace equals `secPerKm` (bisection; T pace falls as VDOT rises). */
export function vdotFromThresholdPace(secPerKm: number): number {
  let lo = 20;
  let hi = 85;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (trainingPaces(mid).thresholdSecPerKm > secPerKm) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface CurrentShapeBound {
  /** VDOT is at least this. */
  vdotAtLeast: number;
  /** So the goal race, on its course, would take no longer than this. */
  timeAtMostS: number;
  effort: SteadyEffort;
}

/** The tightest bound the recent efforts support — the fastest qualifying steady pace. */
export function currentShapeBound(
  efforts: SteadyEffort[],
  raceDistanceM: number,
  courseMultiplier: number,
): CurrentShapeBound | null {
  const usable = efforts.filter(
    (e) => e.paceSecPerKm != null && e.paceSecPerKm > 0 && (e.netElevationM ?? 0) >= -MAX_NET_DESCENT_M,
  );
  if (usable.length === 0) return null;
  const fastest = usable.reduce((best, e) => (e.paceSecPerKm! < best.paceSecPerKm! ? e : best));
  const vdotAtLeast = vdotFromThresholdPace(fastest.paceSecPerKm!);
  return {
    vdotAtLeast,
    timeAtMostS: predictTimeS(vdotAtLeast, raceDistanceM) * courseMultiplier,
    effort: fastest,
  };
}
