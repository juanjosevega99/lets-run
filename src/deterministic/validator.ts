import type { TrainingPhase } from "./trainingPhase.js";

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
  /** Optional coach-v2 readiness constraints. Legacy callers may omit them. */
  trainingPhase?: TrainingPhase;
  longestRunKm30d?: number;
}

export type ViolationRule =
  | "invalid_day"
  | "invalid_planned_km"
  | "rest_session_distance"
  | "rest_day_conflict"
  | "return_to_run_frequency"
  | "return_to_run_intensity"
  | "return_to_run_spacing"
  | "single_run_spike"
  | "volume_progression"
  | "rest_day"
  | "polarized"
  | "consecutive_high";

export interface Violation {
  rule: ViolationRule;
  detail: string;
}

export const MAX_WEEKLY_PROGRESSION = 1.1;
export const MIN_LOW_INTENSITY_SHARE = 0.75;

export function validateWeek(plan: WeekPlanInput): Violation[] {
  const v: Violation[] = [];
  const sessions = plan.sessions;

  // Validate the structural fields again at this boundary even though the LLM path also
  // has a JSON schema. Other callers (templates, tests, future APIs) can invoke this
  // function directly, and invalid numbers must not poison the arithmetic below with NaN.
  for (const [index, session] of sessions.entries()) {
    if (!Number.isInteger(session.day) || session.day < 0 || session.day > 6) {
      v.push({
        rule: "invalid_day",
        detail: `session ${index + 1} (${session.title}) has day ${String(session.day)}; expected an integer from 0 to 6`,
      });
    }
    if (!Number.isFinite(session.plannedKm) || session.plannedKm < 0) {
      v.push({
        rule: "invalid_planned_km",
        detail: `session ${index + 1} (${session.title}) has plannedKm ${String(session.plannedKm)}; expected a finite non-negative number`,
      });
    }
    if (session.intensity === "rest" && Number.isFinite(session.plannedKm) && session.plannedKm > 0) {
      v.push({
        rule: "rest_session_distance",
        detail: `rest session ${index + 1} (${session.title}) carries ${session.plannedKm.toFixed(1)}km; rest sessions must carry 0km`,
      });
    }
  }

  const validDaySessions = sessions.filter((s) => Number.isInteger(s.day) && s.day >= 0 && s.day <= 6);
  const validRunningSessions = validDaySessions.filter(
    (s) => s.intensity !== "rest" && Number.isFinite(s.plannedKm) && s.plannedKm >= 0,
  );

  // A day cannot be declared as rest while also carrying work. Catch this explicitly
  // instead of merely letting the weekly "one rest day" rule reason around the conflict.
  const declaredRestDays = new Set(validDaySessions.filter((s) => s.intensity === "rest").map((s) => s.day));
  for (const day of declaredRestDays) {
    const work = validDaySessions.filter((s) => s.day === day && s.intensity !== "rest");
    if (work.length > 0) {
      v.push({
        rule: "rest_day_conflict",
        detail: `day ${day} is declared rest but also contains ${work.map((s) => `${s.title} (${s.intensity})`).join(", ")}`,
      });
    }
  }

  const totalKm = validRunningSessions.reduce((sum, session) => sum + session.plannedKm, 0);
  const lowKm = validRunningSessions
    .filter((s) => s.intensity === "low")
    .reduce((sum, session) => sum + session.plannedKm, 0);

  if (plan.trainingPhase === "return_to_run") {
    const runSessions = validRunningSessions.filter((s) => s.plannedKm > 0);
    if (runSessions.length !== 3) {
      v.push({
        rule: "return_to_run_frequency",
        detail: `return-to-run requires exactly 3 running sessions; received ${runSessions.length}`,
      });
    }
    if (runSessions.some((s) => s.intensity !== "low")) {
      v.push({
        rule: "return_to_run_intensity",
        detail: "return-to-run permits easy running only; quality work must wait for continuity",
      });
    }
    const runDays = [...new Set(runSessions.map((s) => s.day))].sort((a, b) => a - b);
    if (runDays.some((day, i) => i > 0 && day - runDays[i - 1]! <= 1)) {
      v.push({
        rule: "return_to_run_spacing",
        detail: `return-to-run impact days must be nonconsecutive; received days ${runDays.join(", ")}`,
      });
    }
    const priorLongest = plan.longestRunKm30d ?? 0;
    const singleRunCap = priorLongest > 0 ? priorLongest * 1.1 : 4;
    const longestPlanned = Math.max(0, ...runSessions.map((s) => s.plannedKm));
    if (longestPlanned > singleRunCap + 1e-9) {
      v.push({
        rule: "single_run_spike",
        detail: `longest planned run ${longestPlanned.toFixed(1)}km > return-to-run cap ${singleRunCap.toFixed(1)}km`,
      });
    }
  }

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
  const daysWithWork = new Set(validDaySessions.filter((s) => s.intensity !== "rest").map((s) => s.day));
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
  const highDays = [...new Set(validDaySessions.filter((s) => s.intensity === "high").map((s) => s.day))].sort(
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
