import type { LimiterResult } from "./limiter.js";
import { keyRunDay, lowerBodyConflictsWithKey } from "./schedule.js";

/** Race-cycle phases used by the deterministic coach. */
export type TrainingPhase = "return_to_run" | "base" | "build" | "race_specific" | "taper";

export interface TrainingPhaseInput {
  daysToRace: number;
  daysSinceLastRun: number | null;
  runs28d: number;
  activeRunWeeks4: number;
}

/**
 * Phase selection is goal-aware, but readiness outranks the calendar. A runner who
 * has been away for weeks returns to impact gradually even if the race is close.
 * Once continuity exists, the race clock selects the macro phase.
 */
export function selectTrainingPhase(x: TrainingPhaseInput): TrainingPhase {
  if (
    x.daysSinceLastRun == null ||
    x.daysSinceLastRun > 21 ||
    x.runs28d < 8 ||
    x.activeRunWeeks4 < 3
  ) {
    return "return_to_run";
  }
  if (x.daysToRace <= 14) return "taper";
  if (x.daysToRace <= 84) return "race_specific";
  if (x.daysToRace <= 196) return "build";
  return "base";
}

export interface TrainingFocusInput extends TrainingPhaseInput {
  phase: TrainingPhase;
  longestRunKm30d: number;
  raceKm: number;
  qualityShare28d: number | null;
}

/**
 * Calendar phase constrains the useful focus; observed training chooses within it.
 * This replaces the old "CTL < 60% of an arbitrary historical peak forever means
 * base" gate. CTL remains useful context, but does not decide periodization alone.
 */
export function selectTrainingFocus(x: TrainingFocusInput): LimiterResult {
  if (x.phase === "return_to_run") {
    const gap = x.daysSinceLastRun == null ? "no recent run" : `${x.daysSinceLastRun} days since the last run`;
    return {
      limiter: "aerobic_base",
      reason: `${gap}; re-establish three pain-free, conversational run days before adding intensity`,
    };
  }

  const longRunRatio = x.raceKm > 0 ? x.longestRunKm30d / x.raceKm : 0;
  if (x.phase === "base") {
    return longRunRatio < 0.4
      ? {
          limiter: "long_endurance",
          reason: `base phase: longest recent run ${x.longestRunKm30d.toFixed(1)}km is below 40% of race distance`,
        }
      : {
          limiter: "aerobic_base",
          reason: "base phase: build durable easy volume while preserving strength work",
        };
  }

  if (x.phase === "taper") {
    return {
      limiter: "race_specific",
      reason: "taper phase: preserve race-specific feel while reducing total load",
    };
  }

  if (longRunRatio < 0.6) {
    return {
      limiter: "long_endurance",
      reason: `longest recent run ${x.longestRunKm30d.toFixed(1)}km is below 60% of race distance`,
    };
  }
  if (x.qualityShare28d == null) {
    return {
      limiter: "aerobic_base",
      reason: "recent threshold exposure is unknown; keep effort controlled until a fresh measured anchor exists",
    };
  }
  if (x.qualityShare28d < 0.08) {
    return {
      limiter: "threshold",
      reason: `only ${(x.qualityShare28d * 100).toFixed(1)}% of recent running time was at threshold intensity`,
    };
  }
  return {
    limiter: "race_specific",
    reason: `${x.phase.replace("_", " ")} phase: endurance and threshold exposure are in place`,
  };
}

/** Runs-in-28-days a returning athlete needs before the plan steps 3→4 run days. */
export const RUN_DAY_STEP_UP_RUNS_28D = 12;

/**
 * How many run days the week should carry. Return/taper are always 3. Base and beyond
 * are 4 — EXCEPT for a returning athlete who has only just cleared the return-to-run
 * gate: hold 3 days through early base until running is well established, so the plan
 * doesn't jump 3→4 impact days the instant the phase advances (red-team M1). Legacy
 * callers that omit `runs28d` keep the old phase-only behavior.
 */
export function targetRunDays(phase: TrainingPhase, runs28d?: number): number {
  if (phase === "return_to_run" || phase === "taper") return 3;
  if (runs28d != null && runs28d < RUN_DAY_STEP_UP_RUNS_28D) return 3;
  return 4;
}

/**
 * `allEasy` must match the template shape the plan will use (see `isAllEasyWeek`), so
 * the scheduler protects the SAME key day the template keys and the validator checks.
 * `runs28d` drives the 3-vs-4-day step-up; omit it for legacy phase-only behavior.
 */
export function phaseRunDays(
  phase: TrainingPhase,
  lowerBodyStrengthDays: number[] = [],
  allEasy = true,
  runs28d?: number,
): number[] {
  const count = targetRunDays(phase, runs28d);
  const defaults = count === 3 ? [1, 3, 6] : [0, 2, 4, 6];
  const lower = new Set(lowerBodyStrengthDays);
  const all = combinations([0, 1, 2, 3, 4, 5, 6], count);

  // HARD requirement — a lower-body/key conflict makes plan generation throw, so the
  // returned week must never have one when a clear alternative exists.
  const noConflict = all.filter((days) => !lowerBodyConflictsWithKey(keyRunDay(days, allEasy), lower));
  if (noConflict.length === 0) return defaults; // truly infeasible config; surfaced downstream

  // Three-day weeks can always be fully nonconsecutive, so make that a hard preference
  // tier. Four-day spacing is only ever a SOFT preference (the only fully-spaced 4-day
  // set is [0,2,4,6]; a lower-body conflict can force a tighter week — red-team M1), and
  // is expressed through scheduleScore's adjacency penalties instead.
  const nonconsecutive = noConflict.filter((days) => days.every((day, i) => i === 0 || day - days[i - 1]! > 1));
  const pool = count <= 3 && nonconsecutive.length > 0 ? nonconsecutive : noConflict;

  return pool.reduce((best, days) =>
    scheduleScore(days, defaults, lower, allEasy) < scheduleScore(best, defaults, lower, allEasy) ? days : best,
  );
}

function combinations(values: number[], count: number): number[][] {
  const out: number[][] = [];
  const visit = (start: number, picked: number[]) => {
    if (picked.length === count) {
      out.push(picked);
      return;
    }
    for (let i = start; i < values.length; i++) visit(i + 1, [...picked, values[i]!]);
  };
  visit(0, []);
  return out;
}

function scheduleScore(days: number[], defaults: number[], lower: Set<number>, allEasy: boolean): number {
  const deviation = days.reduce((sum, day, i) => sum + Math.abs(day - defaults[i]!), 0);
  const easyAfterLegs = days.slice(0, -1).filter((day) => day > 0 && lower.has(day - 1)).length;
  // Prefer no back-to-back run days (e.g. [0,2,4,6]), and especially keep the key run
  // out of any back-to-back pair — both soft, so they never block a valid week.
  const key = keyRunDay(days, allEasy);
  let adjacentPairs = 0;
  let keyAdjacent = 0;
  for (let i = 1; i < days.length; i++) {
    if (days[i]! - days[i - 1]! === 1) {
      adjacentPairs++;
      if (days[i] === key || days[i - 1] === key) keyAdjacent = 1;
    }
  }
  return deviation + easyAfterLegs * 2 + adjacentPairs * 3 + keyAdjacent * 4;
}
