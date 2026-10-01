/**
 * What a run ACTUALLY was, from its heart-rate stream — as opposed to what it was
 * planned to be.
 *
 * Until this existed the whole coach judged sessions by their prescription. The review
 * received day, distance and duration and nothing else, so a run prescribed as "20
 * minutes easy" and run as a 40-minute tempo (85% of it above the easy ceiling, a
 * friend setting the pace) was scored as an easy session completed. Every guardrail
 * that reasons about intensity — the S2 polarization floor, "no two hard days in a
 * row" — was checking the plan, never the athlete.
 *
 * The classification reuses the dashboard's own HR bands, so "easy" here can never
 * disagree with the ceiling quoted in the session copy.
 */

import { accumulateZoneTime, emptyZoneTotals, type ZoneStream, type ZoneTotals } from "./zoneTime.js";
import { EASY_SHARE_TARGET, hrZones, type HrBand, type HrProfile } from "./zones.js";

export type RunIntensity = "easy" | "moderate" | "hard" | "unknown";

export interface RunIntensityResult {
  label: RunIntensity;
  /** Share of HR-measured time at or below the easy ceiling (recovery + easy bands). */
  easyShare: number | null;
  /** Share of measured time at or above threshold. */
  hardShare: number | null;
  measuredSeconds: number;
  /** "stream" when classified from samples, "average" when only avg HR was available. */
  source: "stream" | "average" | "none";
}

/**
 * A run counts as hard once at least this share of it sat above the easy ceiling —
 * i.e. most of it. Below the easy target (80% easy) but under this, it is "moderate":
 * a mostly-easy run with real time in the grey zone, e.g. a hilly route.
 */
export const HARD_ABOVE_EASY_SHARE = 0.5;
/** Or once this much of it reached threshold, however the rest was spent. */
export const HARD_THRESHOLD_SHARE = 0.2;
/** Less measured time than this and the stream says nothing trustworthy. */
export const MIN_MEASURED_SECONDS = 300;

export function classifyFromTotals(totals: ZoneTotals): RunIntensityResult {
  const easy = totals.recovery.seconds + totals.easy.seconds;
  const hard = totals.threshold.seconds;
  const measured = easy + totals.moderate.seconds + hard;
  if (measured < MIN_MEASURED_SECONDS) {
    return { label: "unknown", easyShare: null, hardShare: null, measuredSeconds: measured, source: "none" };
  }
  const easyShare = easy / measured;
  const hardShare = hard / measured;
  const label: RunIntensity =
    1 - easyShare >= HARD_ABOVE_EASY_SHARE || hardShare >= HARD_THRESHOLD_SHARE
      ? "hard"
      : easyShare >= EASY_SHARE_TARGET
        ? "easy"
        : "moderate";
  return { label, easyShare, hardShare, measuredSeconds: measured, source: "stream" };
}

export function classifyRunIntensity(stream: ZoneStream, bands: HrBand[]): RunIntensityResult {
  return classifyFromTotals(accumulateZoneTime(stream, bands, emptyZoneTotals()));
}

/**
 * Fallback for a run with no usable stream. An average cannot describe a run's shape —
 * 151 average can be all-easy or half grey-zone — so this only commits at the
 * extremes and calls everything between "moderate", and says it is an estimate.
 */
export function classifyFromAverage(avgHr: number | null, profile: HrProfile): RunIntensityResult {
  if (avgHr == null || !(avgHr > 0)) {
    return { label: "unknown", easyShare: null, hardShare: null, measuredSeconds: 0, source: "none" };
  }
  const z = hrZones(profile);
  const label: RunIntensity = avgHr <= z.easyCeiling ? "easy" : avgHr >= z.threshold ? "hard" : "moderate";
  return { label, easyShare: null, hardShare: null, measuredSeconds: 0, source: "average" };
}

/** Time-weighted easy share across several runs — the polarization number for a week. */
export function combinedEasyShare(results: RunIntensityResult[]): number | null {
  let easy = 0;
  let total = 0;
  for (const r of results) {
    if (r.source !== "stream" || r.easyShare == null) continue;
    easy += r.easyShare * r.measuredSeconds;
    total += r.measuredSeconds;
  }
  return total > 0 ? easy / total : null;
}
