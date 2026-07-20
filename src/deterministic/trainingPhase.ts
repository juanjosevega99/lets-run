import type { LimiterResult } from "./limiter.js";

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
  qualityShare28d: number;
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

export function phaseRunDays(phase: TrainingPhase): number[] {
  switch (phase) {
    case "return_to_run":
      return [1, 3, 6]; // Tue / Thu / Sun: impact exposure separated by recovery
    case "taper":
      return [1, 3, 6];
    default:
      return [0, 2, 4, 6];
  }
}

