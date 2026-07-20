import { describe, expect, it } from "vitest";
import { buildWeekTemplate } from "../deterministic/weekTemplate.js";
import { validateWeek, type PlannedSession } from "../deterministic/validator.js";
import { phaseRunDays } from "../deterministic/trainingPhase.js";
import { isAllEasyWeek, keyRunDay } from "../deterministic/schedule.js";
import { plannedRunVolumeCeiling } from "../deterministic/weekTemplate.js";
import { currentWeekIsComplete, reviewCutoffForReplan, nextMonday, currentMonday } from "./context.js";

/**
 * Regression tests for the findings in docs/coach-v2-redteam-2026-07-19.md.
 * These reproduce the exact scenarios that were broken, at the seam where the bug lived.
 */

// Reproduces generateFreeWeekPlan's own wiring so a template that would make it throw
// is caught here instead. Mirrors the real call in src/plan/freePlan.ts.
function buildAndValidate(input: {
  limiter: Parameters<typeof buildWeekTemplate>[0]["limiter"];
  trainingPhase: Parameters<typeof buildWeekTemplate>[0]["trainingPhase"];
  lowerBodyStrengthDays: number[];
  strengthDays: number[];
  previousWeekKm: number | null;
}) {
  const allEasy = isAllEasyWeek(input.trainingPhase, input.limiter);
  const runDays = phaseRunDays(input.trainingPhase, input.lowerBodyStrengthDays, allEasy);
  const templateInput = {
    limiter: input.limiter,
    limiterReason: "regression",
    trainingPhase: input.trainingPhase,
    previousWeekKm: input.previousWeekKm,
    tsb: -5,
    aerobicTsb: 0,
    totalAtl: 10,
    totalTsb: 0,
    previousDecision: null,
    runDays,
    strengthDays: input.strengthDays,
    lowerBodyStrengthDays: input.lowerBodyStrengthDays,
    longestRunKm30d: 20,
    easyPaceSecPerKm: 360,
    thresholdPaceSecPerKm: 252,
  };
  const plan = buildWeekTemplate(templateInput);
  const sessions: PlannedSession[] = [plan.key_session, ...plan.support_sessions].map((s) => ({
    day: s.day,
    title: s.title,
    intensity: s.intensity,
    plannedKm: s.planned_km,
    plannedMinutes: s.planned_minutes,
  }));
  const violations = validateWeek({
    sessions,
    previousWeekKm: input.previousWeekKm,
    trainingPhase: input.trainingPhase,
    maxPlannedRunKm: plannedRunVolumeCeiling(templateInput),
    longestRunKm30d: 20,
    keySessionDay: plan.key_session.day,
    lowerBodyStrengthDays: input.lowerBodyStrengthDays,
    requiredStrengthDays: input.strengthDays,
  });
  return { plan, runDays, violations };
}

describe("red-team H1 — key-day protection matches the template shape", () => {
  it("does not crash on the intended config: build/threshold with lower-body Tuesday", () => {
    // The reported time-bomb: ATHLETE_LOWER_BODY_DAYS=1, phase leaves all-easy weeks.
    const { runDays, plan, violations } = buildAndValidate({
      limiter: "threshold",
      trainingPhase: "build",
      lowerBodyStrengthDays: [1],
      strengthDays: [1, 4],
      previousWeekKm: 40,
    });
    // The one-high-day template keys the SECOND run day; the scheduler must protect it.
    const keyDay = keyRunDay(runDays, false);
    expect(plan.key_session.day).toBe(keyDay);
    expect(runDays).not.toContain(1); // Tuesday would collide with the key or the day before it
    expect(violations).toEqual([]); // no lower_body_before_key → generateFreeWeekPlan would not throw
  });

  it("still produces a clean week for the all-easy shape with the same lower-body day", () => {
    const { violations } = buildAndValidate({
      limiter: "aerobic_base",
      trainingPhase: "base",
      lowerBodyStrengthDays: [1],
      strengthDays: [1, 4],
      previousWeekKm: 25,
    });
    expect(violations).toEqual([]);
  });

  it("survives lower-body days across the whole week without throwing", () => {
    for (let lower = 0; lower <= 6; lower++) {
      for (const [phase, limiter] of [
        ["build", "threshold"],
        ["race_specific", "race_specific"],
        ["base", "aerobic_base"],
      ] as const) {
        const { violations } = buildAndValidate({
          limiter,
          trainingPhase: phase,
          lowerBodyStrengthDays: [lower],
          strengthDays: [lower],
          previousWeekKm: 30,
        });
        expect(violations, `lower=${lower} ${phase}/${limiter}`).toEqual([]);
      }
    }
  });
});

describe("red-team H2 — Sunday-evening replans baseline on the finished week", () => {
  const sundayEvening = new Date("2026-07-20T01:00:00Z"); // Sun 2026-07-19 20:00 America/Bogota
  const sundayMorning = new Date("2026-07-19T15:00:00Z"); // Sun 10:00 Bogota
  const wednesday = new Date("2026-07-15T17:00:00Z"); // Wed 12:00 Bogota

  it("treats the current week as complete only on Sunday evening", () => {
    expect(currentWeekIsComplete(sundayEvening)).toBe(true);
    expect(currentWeekIsComplete(sundayMorning)).toBe(false);
    expect(currentWeekIsComplete(wednesday)).toBe(false);
  });

  it("aligns the baseline decision with the review cutoff", () => {
    // On Sunday evening the review evaluates the just-finished week AND the baseline
    // uses it — the two must agree, which is exactly currentWeekIsComplete's definition.
    expect(reviewCutoffForReplan(sundayEvening)).toBe(nextMonday(sundayEvening));
    expect(reviewCutoffForReplan(wednesday)).toBe(currentMonday(wednesday));
  });
});
