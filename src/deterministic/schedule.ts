import type { Limiter } from "./limiter.js";
import type { TrainingPhase } from "./trainingPhase.js";

/**
 * Shared week-scheduling helpers. These exist so the run-day *scheduler*
 * (`phaseRunDays`), the *template* (`weekTemplate`), and the *validator* all agree on
 * two facts that used to be duplicated and drifted apart:
 *
 *   1. which run day carries the KEY session, and
 *   2. what counts as a lower-body-strength conflict with it.
 *
 * The drift caused a real crash (red-team H1): the scheduler protected the last run
 * day while the one-high-day template keyed the second, so a validly-configured
 * lower-body day could trip `lower_body_before_key` and make plan generation throw.
 */

/** A week with no quality run: all easy volume (return / base / long-endurance). */
export function isAllEasyWeek(phase: TrainingPhase, limiter: Limiter): boolean {
  return phase === "return_to_run" || limiter === "aerobic_base" || limiter === "long_endurance";
}

/**
 * The day index that will carry the key session — must match weekTemplate exactly.
 * All-easy weeks key the LAST run day (the long run); one-high-day weeks key the
 * SECOND run day (the quality session), with the long run last.
 */
export function keyRunDay(runDays: number[], allEasy: boolean): number {
  if (allEasy) return runDays.at(-1) ?? 6;
  return runDays.length >= 3 ? runDays[1]! : (runDays[0] ?? 2);
}

/**
 * True if a lower-body strength day lands ON the key day or the day immediately
 * before it, counting Sunday→Monday as adjacent (mod 7) — the wraparound the old
 * `keyDay - 1` guard missed (red-team M3).
 */
export function lowerBodyConflictsWithKey(keyDay: number, lowerBodyDays: Iterable<number>): boolean {
  const set = lowerBodyDays instanceof Set ? lowerBodyDays : new Set(lowerBodyDays);
  const dayBefore = (keyDay + 6) % 7;
  return set.has(keyDay) || set.has(dayBefore);
}
