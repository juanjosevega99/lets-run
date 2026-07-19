/**
 * S2 hard-rule plan validator (PROJECT.md §4). These rules are inviolable: the LLM's
 * plan is rejected and regenerated until this function returns zero violations.
 * Deterministic code is the authority; the prompt is not trusted.
 */

export type SessionIntensity = "low" | "high" | "rest";

export interface PlannedSession {
  /** 0 = Monday … 6 = Sunday */
  day: number;
  title: string;
  intensity: SessionIntensity;
  plannedKm: number; // 0 for rest / gym
}

export interface WeekPlanInput {
  sessions: PlannedSession[];
  /** Previous week's actual running volume; null = no baseline (rule 1 skipped). */
  previousWeekKm: number | null;
}

export interface Violation {
  rule: "volume_progression" | "rest_day" | "polarized" | "consecutive_high";
  detail: string;
}

export const MAX_WEEKLY_PROGRESSION = 1.1;
export const MIN_LOW_INTENSITY_SHARE = 0.75;

export function validateWeek(plan: WeekPlanInput): Violation[] {
  const v: Violation[] = [];
  const sessions = plan.sessions;

  const totalKm = sessions.reduce((s, x) => s + x.plannedKm, 0);
  const lowKm = sessions.filter((s) => s.intensity === "low").reduce((s, x) => s + x.plannedKm, 0);

  // 1 — weekly volume progression <= 10%
  if (plan.previousWeekKm != null && plan.previousWeekKm > 0) {
    const limit = plan.previousWeekKm * MAX_WEEKLY_PROGRESSION;
    if (totalKm > limit + 1e-9) {
      v.push({
        rule: "volume_progression",
        detail: `planned ${totalKm.toFixed(1)}km > ${limit.toFixed(1)}km (prev ${plan.previousWeekKm.toFixed(1)}km +10%)`,
      });
    }
  }

  // 2 — at least one full rest day (a day with no non-rest session at all)
  const daysWithWork = new Set(sessions.filter((s) => s.intensity !== "rest").map((s) => s.day));
  if (daysWithWork.size >= 7) {
    v.push({ rule: "rest_day", detail: "no full rest day in the week" });
  }

  // 3 — polarized: >= 75% of running volume at low intensity
  if (totalKm > 0 && lowKm / totalKm < MIN_LOW_INTENSITY_SHARE - 1e-9) {
    v.push({
      rule: "polarized",
      detail: `low-intensity share ${((lowKm / totalKm) * 100).toFixed(0)}% < 75%`,
    });
  }

  // 4 — no two high-intensity sessions on consecutive days
  const highDays = [...new Set(sessions.filter((s) => s.intensity === "high").map((s) => s.day))].sort(
    (a, b) => a - b,
  );
  for (let i = 1; i < highDays.length; i++) {
    if (highDays[i]! - highDays[i - 1]! === 1) {
      v.push({
        rule: "consecutive_high",
        detail: `high-intensity on consecutive days ${highDays[i - 1]} and ${highDays[i]}`,
      });
    }
  }

  return v;
}
