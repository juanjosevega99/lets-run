/**
 * Coaching properties — the tier above the S2 validator.
 *
 * The validator answers "does this week break a rule?". Every real defect found by
 * reading the live plan against the actual training log passed it cleanly:
 *
 *   - a 2.6km "long run" beside two 3.1km easy runs (the key was the SHORTEST run);
 *   - a prescription that ratcheted 5.4 → 4.5 → 1.6km while the athlete was running
 *     5.6km unprompted, because the baseline followed him down;
 *   - five consecutive weeks prescribing Tue/Thu/Sun to someone who ran Mon/Wed/Sun;
 *   - "walk breaks are allowed" offered to an athlete who had just run 5.8km unbroken.
 *
 * None of those is a rule violation. The week was VALID every time. They are plans
 * that are internally consistent and coaching nonsense — a category the validator
 * cannot express, because each one is about the plan's relationship to the ATHLETE
 * rather than to the rulebook.
 *
 * So these are properties, not rules: they are advisory (the caller logs them), and
 * the test suite asserts them across the generated template matrix as a permanent
 * regression net. A rule failing is a crash; a property failing is the plan quietly
 * ceasing to make sense.
 */

import type { PlannedSession } from "./validator.js";
import type { TrainingPhase } from "./trainingPhase.js";
import type { WeekDecision } from "../plan/review.js";

export type CoachProperty =
  | "key_is_the_longest_run"
  | "key_is_the_hard_session"
  | "not_below_recent_behavior"
  | "progress_actually_progresses"
  | "days_match_the_athletes_week"
  | "copy_matches_demonstrated_capacity";

export interface CoachPropertyViolation {
  property: CoachProperty;
  detail: string;
}

export interface CoachPropertyInput {
  sessions: PlannedSession[];
  keySession: PlannedSession;
  trainingPhase: TrainingPhase;
  previousDecision: WeekDecision | null;
  previousWeekKm: number | null;
  /** Completed weekly running volume, oldest first. */
  recentWeeklyKm?: number[];
  longestRunKm30d: number;
  /** Habitual run weekdays; empty when unknown, which skips that property. */
  preferredRunDays?: number[];
}

/** Fraction of a recent peak week a plan may fall below before it is ignorable. */
const BEHAVIOR_FLOOR_SHARE = 0.8;
/** How much of the week's run days must sit on habitual days once they are known. */
const MIN_HABIT_OVERLAP = 0.5;

const isRun = (s: PlannedSession): boolean =>
  s.intensity !== "rest" && (s.plannedKm > 0 || (s.plannedMinutes ?? 0) > 0);

/** Compare sessions in whichever unit the week was prescribed in. */
const dose = (s: PlannedSession, byMinutes: boolean): number =>
  byMinutes ? (s.plannedMinutes ?? 0) : s.plannedKm;

export function checkCoachProperties(x: CoachPropertyInput): CoachPropertyViolation[] {
  const v: CoachPropertyViolation[] = [];
  const runs = x.sessions.filter(isRun);
  if (runs.length === 0) return v;

  // 1 — the key session must be the week's actual focus, which means different things
  // in the two week shapes. In an ALL-EASY week the key IS the long run, so it has to
  // be the longest; a "key session" shorter than the easy runs beside it is not a key
  // session. In a week with quality, the key is the HARD session and the long run is
  // deliberately longer — there, being longest is the wrong test entirely.
  const allEasy = x.sessions.every((s) => s.intensity !== "high");
  const byMinutes = runs.every((s) => (s.plannedMinutes ?? 0) > 0);
  const keyDose = dose(x.keySession, byMinutes);
  if (allEasy) {
    const longest = Math.max(...runs.map((s) => dose(s, byMinutes)));
    if (keyDose + 1e-9 < longest) {
      v.push({
        property: "key_is_the_longest_run",
        detail: `all-easy week: key session is ${keyDose} but the week's longest run is ${longest}`,
      });
    }
  } else if (x.keySession.intensity !== "high") {
    v.push({
      property: "key_is_the_hard_session",
      detail: `week has quality work but the key session "${x.keySession.title}" is ${x.keySession.intensity}`,
    });
  }

  const plannedKm = runs.reduce((sum, s) => sum + s.plannedKm, 0);

  // 2 — a plan the athlete has already outrun is a plan he will ignore. Three phases
  // are ALLOWED to sit below recent behavior, because prescribing less is the entire
  // point of each: a taper, an explicit deload, and return-to-run (whose per-session
  // caps deliberately hold an athlete under what his cardiovascular system could
  // manage, because the limiter is tissue tolerance rather than fitness).
  const recentPeak = Math.max(0, ...(x.recentWeeklyKm ?? []).slice(-4));
  const cuttingDeliberately =
    x.trainingPhase === "taper" || x.trainingPhase === "return_to_run" || x.previousDecision === "DELOAD";
  if (!cuttingDeliberately && recentPeak > 0 && plannedKm + 1e-9 < recentPeak * BEHAVIOR_FLOOR_SHARE) {
    v.push({
      property: "not_below_recent_behavior",
      detail: `planned ${plannedKm.toFixed(1)}km is under ${(BEHAVIOR_FLOOR_SHARE * 100).toFixed(0)}% of a recent ${recentPeak.toFixed(1)}km week`,
    });
  }

  // 3 — PROGRESS is the one decision that promises a bigger week. If it does not
  // deliver one, the controller is telling the athlete something untrue.
  // Return-to-run's session caps legitimately outrank an earned PROGRESS for the same
  // reason: readiness outranks the calendar, and tissue outranks both.
  if (
    x.previousDecision === "PROGRESS" &&
    !cuttingDeliberately &&
    x.previousWeekKm != null &&
    x.previousWeekKm > 0 &&
    plannedKm <= x.previousWeekKm + 1e-9
  ) {
    v.push({
      property: "progress_actually_progresses",
      detail: `previous week earned PROGRESS but planned ${plannedKm.toFixed(1)}km <= last week's ${x.previousWeekKm.toFixed(1)}km`,
    });
  }

  // 4 — scheduling sessions on days the athlete never trains does not make him train
  // on those days; it makes the plan wrong every week. Placement is logistics, and
  // logistics should fit the athlete.
  const habit = new Set(x.preferredRunDays ?? []);
  if (habit.size > 0) {
    const onHabit = runs.filter((s) => habit.has(s.day)).length;
    if (onHabit < runs.length * MIN_HABIT_OVERLAP) {
      v.push({
        property: "days_match_the_athletes_week",
        detail: `${onHabit} of ${runs.length} run days fall on habitual days (${[...habit].sort((a, b) => a - b).join(",")})`,
      });
    }
  }

  // 5 — copy that contradicts what the athlete just did reads as a demotion for a week
  // he earned, and quietly undermines the prescription it is attached to.
  if (x.longestRunKm30d > 0) {
    for (const s of runs) {
      if (s.plannedKm > 0 && s.plannedKm <= x.longestRunKm30d && /walk/i.test(s.title)) {
        v.push({
          property: "copy_matches_demonstrated_capacity",
          detail: `"${s.title}" offers walk breaks for ${s.plannedKm}km, already run unbroken (${x.longestRunKm30d}km)`,
        });
      }
    }
  }

  return v;
}
