/**
 * Race trajectory — the forward half of the coach.
 *
 * Every other number in the controller looks BACKWARDS: last week's volume, the recent
 * peak, whether the last plan was completed. Nothing answered the question the athlete
 * actually asks — "where do I need to be in December, and am I on track for April?"
 * This module answers it, and it answers it in the only currency that matters for a
 * runner rebuilding from a low base: not "train harder" but "how many weeks can I still
 * afford to miss".
 *
 * The model is deliberately small and inspectable (PROJECT.md §3 — deterministic code
 * owns the math, the LLM only phrases it):
 *
 *   peak long run   = race distance (a half marathon is short enough to rehearse whole)
 *   peak weekly km  = peak long run / MAX_LONG_RUN_SHARE_OF_WEEK
 *   required rate   = (peak / current) ^ (1 / growth weeks) - 1
 *
 * Progression is multiplicative, so the interpolation is geometric, not linear. The
 * required rate is then compared against the SAME +10%/week ceiling the S2 validator
 * enforces — so "is the goal reachable safely?" becomes arithmetic instead of opinion.
 */

/** Weeks of taper before race day; no volume growth is planned inside this window. */
export const TAPER_WEEKS = 3;
/** One week in four is a down week, so it cannot carry growth. */
export const DOWN_WEEK_SHARE = 0.25;
/**
 * A half marathon is short enough to rehearse at full distance in training, and this
 * course is trail: arriving having never covered the distance is the biggest single
 * predictor of a bad day. Longer races would use a fraction well below 1.
 */
export const PEAK_LONG_RUN_SHARE_OF_RACE = 1;
/**
 * Ceiling on what fraction of weekly volume the long run may be at peak. 40% matches
 * the template's own long-run share for a low-frequency week; a runner whose long run
 * is more than this is not durable, just enduring one heroic day.
 */
export const MAX_LONG_RUN_SHARE_OF_WEEK = 0.4;
/** The same weekly ceiling the S2 validator enforces (validator.MAX_WEEKLY_PROGRESSION). */
export const SAFE_WEEKLY_GROWTH = 0.1;

export type TrajectoryStatus =
  | "no_baseline"
  | "taper"
  | "arrived"
  | "on_track"
  | "tight"
  | "at_risk"
  | "unreachable";

export interface TrajectoryInput {
  raceKm: number;
  weeksToRace: number;
  currentWeeklyKm: number;
  currentLongestRunKm: number;
}

export interface Trajectory {
  status: TrajectoryStatus;
  peakWeeklyKm: number;
  peakLongRunKm: number;
  /** Weeks that can actually carry growth: excludes the taper and the down weeks. */
  growthWeeks: number;
  /** Compounding weekly growth needed from here, as a fraction (0.09 = +9%/week). */
  requiredWeeklyGrowth: number | null;
  requiredLongRunGrowth: number | null;
  /**
   * Whole calendar weeks that can be lost entirely and still leave the goal reachable
   * at <= SAFE_WEEKLY_GROWTH. Negative means the goal already needs unsafe progression.
   */
  slackWeeks: number | null;
  /** Where this week's volume should land to stay on the curve. */
  thisWeekTargetKm: number | null;
  headline: string;
}

export function raceTrajectory(x: TrajectoryInput): Trajectory {
  const peakLongRunKm = round1(x.raceKm * PEAK_LONG_RUN_SHARE_OF_RACE);
  const peakWeeklyKm = round1(peakLongRunKm / MAX_LONG_RUN_SHARE_OF_WEEK);
  const growthWeeks = Math.max(0, x.weeksToRace - TAPER_WEEKS) * (1 - DOWN_WEEK_SHARE);
  const base: Omit<Trajectory, "status" | "headline"> = {
    peakWeeklyKm,
    peakLongRunKm,
    growthWeeks,
    requiredWeeklyGrowth: null,
    requiredLongRunGrowth: null,
    slackWeeks: null,
    thisWeekTargetKm: null,
  };

  if (growthWeeks <= 0) {
    return { ...base, status: "taper", headline: "Inside the taper — hold what you have and arrive fresh." };
  }
  if (x.currentWeeklyKm <= 0) {
    // No baseline to compound from. Saying "you need +infinity%" would be nonsense;
    // the honest instruction is to establish any consistent week first.
    return {
      ...base,
      status: "no_baseline",
      headline: `No running baseline yet. Establish any consistent week — the curve to ${peakWeeklyKm.toFixed(0)} km/wk can only be measured from a starting point.`,
    };
  }
  if (x.currentWeeklyKm >= peakWeeklyKm) {
    return {
      ...base,
      requiredWeeklyGrowth: 0,
      thisWeekTargetKm: round1(x.currentWeeklyKm),
      slackWeeks: Math.floor(growthWeeks / (1 - DOWN_WEEK_SHARE)),
      status: "arrived",
      headline: `Already at the ${peakWeeklyKm.toFixed(0)} km/wk the race asks for. Hold it and sharpen.`,
    };
  }

  const ratio = peakWeeklyKm / x.currentWeeklyKm;
  const requiredWeeklyGrowth = Math.pow(ratio, 1 / growthWeeks) - 1;
  const weeksNeededAtSafeRate = Math.log(ratio) / Math.log(1 + SAFE_WEEKLY_GROWTH);
  // Convert spare GROWTH weeks back into whole calendar weeks the athlete may lose.
  const slackWeeks = Math.floor((growthWeeks - weeksNeededAtSafeRate) / (1 - DOWN_WEEK_SHARE));
  const requiredLongRunGrowth =
    x.currentLongestRunKm > 0 ? Math.pow(peakLongRunKm / x.currentLongestRunKm, 1 / growthWeeks) - 1 : null;
  const thisWeekTargetKm = round1(Math.min(peakWeeklyKm, x.currentWeeklyKm * (1 + requiredWeeklyGrowth)));
  const pct = (requiredWeeklyGrowth * 100).toFixed(1);

  const status: TrajectoryStatus =
    requiredWeeklyGrowth > SAFE_WEEKLY_GROWTH
      ? "unreachable"
      : slackWeeks < 2
        ? "at_risk"
        : slackWeeks < 6
          ? "tight"
          : "on_track";

  const headline =
    status === "unreachable"
      ? `Reaching ${peakWeeklyKm.toFixed(0)} km/wk by race week now needs +${pct}%/week, above the +10% that is safe to sustain. Either the target volume or the race goal has to move.`
      : status === "at_risk"
        ? `+${pct}%/week needed, with ${slackWeeks === 0 ? "no" : slackWeeks} spare ${slackWeeks === 1 ? "week" : "weeks"} left. Another missed week costs the goal, not just the week.`
        : status === "tight"
          ? `+${pct}%/week needed. ${slackWeeks} spare weeks in hand — enough for illness or travel, not for drift.`
          : `+${pct}%/week needed to reach ${peakWeeklyKm.toFixed(0)} km/wk, with ${slackWeeks} spare weeks in hand. The margin is in consistency, not in bigger weeks.`;

  return {
    ...base,
    status,
    requiredWeeklyGrowth,
    requiredLongRunGrowth,
    slackWeeks,
    thisWeekTargetKm,
    headline,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
