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

/**
 * `allEasy` must match the template shape the plan will use (see `isAllEasyWeek`), so
 * the scheduler protects the SAME key day the template keys and the validator checks.
 * Defaults to true for legacy callers (all-easy is the conservative assumption).
 */
export function phaseRunDays(
  phase: TrainingPhase,
  lowerBodyStrengthDays: number[] = [],
  allEasy = true,
): number[] {
  const defaults = phase === "return_to_run" || phase === "taper" ? [1, 3, 6] : [0, 2, 4, 6];
  const lower = new Set(lowerBodyStrengthDays);
  const requiresSpacing = defaults.length === 3;
  const candidates = combinations([0, 1, 2, 3, 4, 5, 6], defaults.length).filter((days) => {
    if (lowerBodyConflictsWithKey(keyRunDay(days, allEasy), lower)) return false;
    return !requiresSpacing || days.every((day, i) => i === 0 || day - days[i - 1]! > 1);
  });
  if (candidates.length === 0) return defaults;
  return candidates.reduce((best, days) =>
    scheduleScore(days, defaults, lower) < scheduleScore(best, defaults, lower) ? days : best,
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

function scheduleScore(days: number[], defaults: number[], lower: Set<number>): number {
  const deviation = days.reduce((sum, day, i) => sum + Math.abs(day - defaults[i]!), 0);
  const easyAfterLegs = days.slice(0, -1).filter((day) => day > 0 && lower.has(day - 1)).length;
  return deviation + easyAfterLegs * 2;
}
