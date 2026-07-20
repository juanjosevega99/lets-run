import { describe, expect, it } from "vitest";
import { buildWeekTemplate, type WeekTemplateInput } from "./weekTemplate.js";
import { validateWeek, type PlannedSession } from "./validator.js";
import type { Limiter } from "./limiter.js";

const LIMITERS: Limiter[] = ["aerobic_base", "long_endurance", "threshold", "race_specific"];
const PREV_WEEK_OPTIONS = [null, 0, 10, 25, 40];
const TSB_OPTIONS = [-40, -25, -15, -5, 0, 10];

function baseInput(overrides: Partial<WeekTemplateInput> = {}): WeekTemplateInput {
  return {
    limiter: "aerobic_base",
    limiterReason: "test reason",
    trainingPhase: "base",
    previousWeekKm: 20,
    tsb: -5,
    totalAtl: 10,
    totalTsb: 0,
    previousDecision: null,
    runDays: [0, 2, 4, 6],
    strengthDays: [1, 5],
    lowerBodyStrengthDays: [1],
    longestRunKm30d: 20,
    easyPaceSecPerKm: 360,
    thresholdPaceSecPerKm: 252,
    ...overrides,
  };
}

function toSessions(plan: ReturnType<typeof buildWeekTemplate>): PlannedSession[] {
  return [plan.key_session, ...plan.support_sessions].map((s) => ({
    day: s.day,
    title: s.title,
    intensity: s.intensity,
    plannedKm: s.planned_km,
  }));
}

function runningSessions(plan: ReturnType<typeof buildWeekTemplate>) {
  return [plan.key_session, ...plan.support_sessions].filter((s) => s.planned_km > 0);
}

function totalRunKm(plan: ReturnType<typeof buildWeekTemplate>): number {
  return runningSessions(plan).reduce((sum, session) => sum + session.planned_km, 0);
}

describe("buildWeekTemplate — always produces an S2-valid week", () => {
  for (const limiter of LIMITERS) {
    for (const previousWeekKm of PREV_WEEK_OPTIONS) {
      for (const tsb of TSB_OPTIONS) {
        it(`limiter=${limiter} prevKm=${previousWeekKm} tsb=${tsb}`, () => {
          const plan = buildWeekTemplate(baseInput({ limiter, previousWeekKm, tsb }));
          const violations = validateWeek({ sessions: toSessions(plan), previousWeekKm });
          expect(violations).toEqual([]);
        });
      }
    }
  }

  it("also holds with no pace data available (null)", () => {
    const plan = buildWeekTemplate(
      baseInput({ limiter: "threshold", easyPaceSecPerKm: null, thresholdPaceSecPerKm: null }),
    );
    const violations = validateWeek({ sessions: toSessions(plan), previousWeekKm: 20 });
    expect(violations).toEqual([]);
    expect(plan.key_session.description).not.toContain("null");
    expect(plan.key_session.description).not.toContain("undefined");
  });
});

describe("buildWeekTemplate — behavior", () => {
  it("covers the full calendar without putting rest and work on the same day", () => {
    const plan = buildWeekTemplate(baseInput());
    const sessions = toSessions(plan);
    const days = [...new Set(sessions.map((s) => s.day))].sort((a, b) => a - b);
    expect(days).toEqual([0, 1, 2, 3, 4, 5, 6]);

    for (const day of days) {
      const onDay = sessions.filter((s) => s.day === day);
      const hasRest = onDay.some((s) => s.intensity === "rest");
      const hasWork = onDay.some((s) => s.intensity !== "rest");
      expect(hasRest && hasWork).toBe(false);
    }
  });

  it("aerobic_base and long_endurance weeks are 100% low intensity", () => {
    for (const limiter of ["aerobic_base", "long_endurance"] as const) {
      const plan = buildWeekTemplate(baseInput({ limiter }));
      const sessions = toSessions(plan);
      expect(sessions.every((s) => s.intensity !== "high")).toBe(true);
    }
  });

  it("threshold and race_specific weeks have exactly one high session, on the key session", () => {
    for (const limiter of ["threshold", "race_specific"] as const) {
      const plan = buildWeekTemplate(baseInput({ limiter }));
      const sessions = toSessions(plan);
      const highSessions = sessions.filter((s) => s.intensity === "high");
      expect(highSessions).toHaveLength(1);
      expect(plan.key_session.intensity).toBe("high");
    }
  });

  it("counts threshold warm-up and cool-down inside the planned session dose", () => {
    const plan = buildWeekTemplate(baseInput({ limiter: "threshold", trainingPhase: "build" }));
    expect(plan.key_session.description).toContain("total, including easy warm-up/cool-down");
    expect(plan.key_session.description).not.toContain("not included");
  });

  it("holds volume unless the previous review explicitly earned progression", () => {
    for (const previousDecision of [null, "REPEAT", "PROCEED"] as const) {
      const plan = buildWeekTemplate(baseInput({ previousWeekKm: 20, tsb: 0, previousDecision }));
      expect(totalRunKm(plan)).toBeLessThanOrEqual(20);
      expect(totalRunKm(plan)).toBeGreaterThan(19);
    }

    const progressed = buildWeekTemplate(
      baseInput({ previousWeekKm: 20, tsb: 0, previousDecision: "PROGRESS" }),
    );
    expect(totalRunKm(progressed)).toBeLessThanOrEqual(21);
    expect(totalRunKm(progressed)).toBeGreaterThan(20);
  });

  it("lets fatigue and a DELOAD decision override earned progression", () => {
    const fatigued = buildWeekTemplate(
      baseInput({ previousWeekKm: 20, tsb: -25, previousDecision: "PROGRESS" }),
    );
    expect(totalRunKm(fatigued)).toBeLessThanOrEqual(18);
    expect(totalRunKm(fatigued)).toBeGreaterThan(17);

    const crossTrainingFatigued = buildWeekTemplate(
      baseInput({ previousWeekKm: 20, tsb: 0, totalTsb: -30, previousDecision: "PROGRESS" }),
    );
    expect(totalRunKm(crossTrainingFatigued)).toBeLessThanOrEqual(18);

    const deload = buildWeekTemplate(
      baseInput({ previousWeekKm: 20, tsb: 0, previousDecision: "DELOAD" }),
    );
    expect(totalRunKm(deload)).toBeLessThanOrEqual(16);
    expect(totalRunKm(deload)).toBeGreaterThan(15);
  });

  it("uses phase-specific conservative defaults when there is no volume baseline", () => {
    const base = buildWeekTemplate(baseInput({ previousWeekKm: null, tsb: 0 }));
    expect(totalRunKm(base)).toBeLessThanOrEqual(12);
    expect(totalRunKm(base)).toBeGreaterThan(11);

    const returning = buildWeekTemplate(
      baseInput({
        trainingPhase: "return_to_run",
        previousWeekKm: null,
        tsb: 0,
        runDays: [1, 3, 6],
      }),
    );
    expect(totalRunKm(returning)).toBeLessThanOrEqual(10);
    expect(totalRunKm(returning)).toBeGreaterThan(9);
  });

  it("caps the longest run at 110% of the longest run from the last 30 days", () => {
    const plan = buildWeekTemplate(baseInput({ longestRunKm30d: 3 }));
    expect(plan.key_session.planned_km).toBeLessThanOrEqual(3.3);
  });

  it("includes real paces in session descriptions when available", () => {
    const plan = buildWeekTemplate(baseInput({ limiter: "aerobic_base", easyPaceSecPerKm: 360 }));
    expect(plan.key_session.description).toContain("6:00/km");
  });

  it("leads with the HR ceiling and demotes pace to a guide when HR data exists", () => {
    const plan = buildWeekTemplate(
      baseInput({ limiter: "aerobic_base", easyPaceSecPerKm: 435, easyHrCeiling: 159 }),
    );
    for (const s of runningSessions(plan)) {
      expect(s.description).toContain("full-sentence conversational effort");
      expect(s.description).toContain("HR under 159 bpm");
      expect(s.description).toContain("effort governs");
      expect(s.description).toContain("slow down or walk as needed");
    }
  });

  it("falls back to conversational-effort wording when there is no HR data at all", () => {
    const plan = buildWeekTemplate(
      baseInput({ limiter: "aerobic_base", easyPaceSecPerKm: null, easyHrCeiling: null }),
    );
    expect(plan.key_session.description).toContain("conversational");
    expect(plan.key_session.description).not.toContain("undefined");
    expect(plan.key_session.description).not.toContain("NaN");
  });

  it("explanation names the phase, prior decision, limiter evidence, and gym context", () => {
    const plan = buildWeekTemplate(
      baseInput({
        trainingPhase: "return_to_run",
        previousDecision: "REPEAT",
        limiterReason: "81 days since the last run",
      }),
    );
    expect(plan.explanation).toContain("Coach v2 · return to run");
    expect(plan.explanation).toContain("81 days since the last run");
    expect(plan.explanation).toContain("Previous-week decision: REPEAT");
    expect(plan.explanation).toContain("Gym work is shown on 2");
  });
});

describe("buildWeekTemplate — return-to-run and gym calendar", () => {
  it("prescribes exactly 3 nonconsecutive, all-easy runs", () => {
    const plan = buildWeekTemplate(
      baseInput({
        trainingPhase: "return_to_run",
        runDays: [1, 3, 6],
        previousWeekKm: null,
        strengthDays: [0, 4],
        lowerBodyStrengthDays: [0],
      }),
    );
    const runs = runningSessions(plan).sort((a, b) => a.day - b.day);

    expect(runs).toHaveLength(3);
    expect(runs.map((s) => s.day)).toEqual([1, 3, 6]);
    expect(runs.every((s) => s.intensity === "low")).toBe(true);
    expect(plan.key_session.title).toBe("Longest easy run/walk");
    expect(runs.map((s) => s.planned_minutes)).toEqual([20, 25, 30]);
    expect(runs.every((s) => s.description.includes("Walk breaks are allowed"))).toBe(true);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i]!.day - runs[i - 1]!.day).toBeGreaterThan(1);
    }
  });

  it("places configured gym sessions, identifies lower-body work, and preserves full rest days", () => {
    const plan = buildWeekTemplate(
      baseInput({
        trainingPhase: "return_to_run",
        runDays: [1, 3, 6],
        strengthDays: [0, 4],
        lowerBodyStrengthDays: [0],
      }),
    );
    const sessions = [plan.key_session, ...plan.support_sessions];
    const gym = sessions.filter((s) => s.planned_km === 0 && s.title.toLowerCase().includes("strength"));
    const rest = sessions.filter((s) => s.intensity === "rest");

    expect(gym.map((s) => s.day).sort((a, b) => a - b)).toEqual([0, 4]);
    expect(gym.find((s) => s.day === 0)?.title).toBe("Lower-body strength");
    expect(gym.find((s) => s.day === 4)?.title).toBe("Strength training");
    expect(rest.map((s) => s.day).sort((a, b) => a - b)).toEqual([2, 5]);

    for (const restSession of rest) {
      expect(sessions.some((s) => s.day === restSession.day && s.intensity !== "rest")).toBe(false);
    }
    expect(validateWeek({ sessions: toSessions(plan), previousWeekKm: 20 })).toEqual([]);
  });

  it("supports a run and gym session on the same day without labeling that day as rest", () => {
    const plan = buildWeekTemplate(
      baseInput({
        trainingPhase: "return_to_run",
        runDays: [1, 3, 6],
        strengthDays: [1, 4],
        lowerBodyStrengthDays: [],
      }),
    );
    const sessions = [plan.key_session, ...plan.support_sessions];
    const tuesday = sessions.filter((s) => s.day === 1);

    expect(tuesday.filter((s) => s.planned_km > 0)).toHaveLength(1);
    expect(tuesday.filter((s) => s.title === "Strength training")).toHaveLength(1);
    expect(tuesday.some((s) => s.intensity === "rest")).toBe(false);
    expect(sessions.some((s) => s.intensity === "rest")).toBe(true);
  });

  it("reduces gym work when whole-program load is deeply negative", () => {
    const plan = buildWeekTemplate(baseInput({ totalTsb: -30, strengthDays: [0], lowerBodyStrengthDays: [0] }));
    const gym = plan.support_sessions.find((s) => s.title === "Lower-body strength");
    expect(gym?.description).toContain("cut volume");
    expect(gym?.description).toContain("3 reps in reserve");
  });
});
