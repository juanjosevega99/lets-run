import { describe, expect, it } from "vitest";
import { buildWeekTemplate, plannedRunVolumeCeiling, type WeekTemplateInput } from "./weekTemplate.js";
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
    aerobicTsb: 0,
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

  it("lets running/aerobic fatigue and a DELOAD decision override earned progression", () => {
    const fatigued = buildWeekTemplate(
      baseInput({ previousWeekKm: 20, tsb: -25, previousDecision: "PROGRESS" }),
    );
    expect(totalRunKm(fatigued)).toBeLessThanOrEqual(18);
    expect(totalRunKm(fatigued)).toBeGreaterThan(17);

    const crossTrainingFatigued = buildWeekTemplate(
      baseInput({ previousWeekKm: 20, tsb: 0, aerobicTsb: -30, totalTsb: -30, previousDecision: "PROGRESS" }),
    );
    expect(totalRunKm(crossTrainingFatigued)).toBeLessThanOrEqual(18);

    const gymOnlyLoad = buildWeekTemplate(
      baseInput({ previousWeekKm: 20, tsb: 0, aerobicTsb: 0, totalTsb: -30, previousDecision: "PROGRESS" }),
    );
    expect(totalRunKm(gymOnlyLoad)).toBeGreaterThan(20);

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

  it("caps the return long-run DURATION too, so an overshoot week can't jump it +40%", () => {
    // Reproduces the real case: after an overachieved return week (ran 14.4km vs the 10km
    // default) the long run must not balloon 30→43 min. Its km is held to 110% of the
    // longest recent run; its minutes now inherit the same guardrail instead of scaling
    // off raw weekly volume.
    const plan = buildWeekTemplate(
      baseInput({
        trainingPhase: "return_to_run",
        limiter: "aerobic_base",
        runDays: [1, 3, 6],
        previousWeekKm: 14.4,
        longestRunKm30d: 4.1,
        previousDecision: "PROCEED",
      }),
    );
    const key = plan.key_session;
    expect(key.title).toBe("Longest easy run/walk");
    expect(key.planned_minutes!).toBeLessThanOrEqual(35); // ~34, not 43
    // Minutes and km must imply the same easy run/walk pace — the copy can't self-contradict.
    const paceMinPerKm = key.planned_minutes! / key.planned_km;
    expect(paceMinPerKm).toBeGreaterThan(6.5);
    expect(paceMinPerKm).toBeLessThan(8.5);
  });

  it("leaves the standard 30-min return long run unchanged at the default baseline", () => {
    const plan = buildWeekTemplate(
      baseInput({
        trainingPhase: "return_to_run",
        limiter: "aerobic_base",
        runDays: [1, 3, 6],
        previousWeekKm: 10,
        longestRunKm30d: 4,
        previousDecision: "PROCEED",
      }),
    );
    expect(plan.key_session.planned_minutes!).toBe(30);
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

describe("buildWeekTemplate — the long run is the longest run", () => {
  // Regression: a flat 30% long-run share on a 3-day week (even split 33%) made the
  // KEY session the SHORTEST run — a 2.6km "long run" beside two 3.1km easy runs.
  it("keeps the key session longer than every easy run at 3 run days", () => {
    const plan = buildWeekTemplate(
      baseInput({ limiter: "long_endurance", previousWeekKm: 8.9, longestRunKm30d: 5.61, runDays: [1, 3, 6] }),
    );
    const easy = plan.support_sessions.filter((s) => s.planned_km > 0);
    expect(easy.length).toBe(2);
    for (const s of easy) expect(plan.key_session.planned_km).toBeGreaterThan(s.planned_km);
  });

  it("keeps the key session longest at 4 and 5 run days too", () => {
    for (const runDays of [[0, 2, 4, 6], [0, 1, 3, 4, 6]]) {
      const plan = buildWeekTemplate(
        baseInput({ limiter: "aerobic_base", previousWeekKm: 40, longestRunKm30d: 20, runDays }),
      );
      for (const s of plan.support_sessions.filter((s) => s.planned_km > 0)) {
        expect(plan.key_session.planned_km).toBeGreaterThan(s.planned_km);
      }
    }
  });

  it("still respects the +10% session cap over the longest recent run", () => {
    const plan = buildWeekTemplate(
      baseInput({ limiter: "long_endurance", previousWeekKm: 40, longestRunKm30d: 5, runDays: [1, 3, 6] }),
    );
    expect(plan.key_session.planned_km).toBeLessThanOrEqual(5 * 1.1);
  });
});

describe("plannedRunVolumeCeiling — recovers ground already proven", () => {
  const ceiling = (over: Partial<WeekTemplateInput>) =>
    plannedRunVolumeCeiling(baseInput({ tsb: 0, previousDecision: "REPEAT", ...over }));

  // Regression: anchoring only on last week made the plan a FOLLOWER — one interrupted
  // week reset the baseline for good and the prescription sank below what the athlete
  // was already running unprompted.
  it("does not sink to a single interrupted week when recent weeks were bigger", () => {
    expect(ceiling({ previousWeekKm: 8.9, recentWeeklyKm: [14.4, 5, 4.1, 8.9] })).toBeCloseTo(11.5, 1);
  });

  it("never drops below last week when last week was the best week", () => {
    expect(ceiling({ previousWeekKm: 20, recentWeeklyKm: [5, 8, 12, 20] })).toBeCloseTo(20, 1);
  });

  it("ignores a peak older than the lookback window", () => {
    expect(ceiling({ previousWeekKm: 8, recentWeeklyKm: [60, 8, 8, 8, 8] })).toBeCloseTo(8, 1);
  });

  it("still lets DELOAD and the fatigue guardrail cut volume", () => {
    expect(ceiling({ previousWeekKm: 20, recentWeeklyKm: [20, 20], previousDecision: "DELOAD" })).toBeCloseTo(16, 1);
    expect(ceiling({ previousWeekKm: 20, recentWeeklyKm: [20, 20], tsb: -25 })).toBeCloseTo(18, 1);
  });

  it("never looks backwards for volume during a taper", () => {
    expect(
      ceiling({ trainingPhase: "taper", previousWeekKm: 20, recentWeeklyKm: [50, 40, 30, 20] }),
    ).toBeCloseTo(15, 1);
  });

  it("is unchanged when no recent-week history is supplied", () => {
    expect(ceiling({ previousWeekKm: 20, recentWeeklyKm: undefined })).toBeCloseTo(20, 1);
  });
});

describe("plannedRunVolumeCeiling — the trajectory shapes growth but never creates it", () => {
  const ceiling = (over: Partial<WeekTemplateInput>) =>
    plannedRunVolumeCeiling(baseInput({ tsb: 0, previousWeekKm: 20, recentWeeklyKm: [20], ...over }));

  it("ignores the trajectory when readiness has not earned progression", () => {
    for (const previousDecision of ["REPEAT", "PROCEED", null] as const) {
      expect(ceiling({ previousDecision, trajectoryTargetKm: 40 })).toBeCloseTo(20, 1);
    }
  });

  it("lifts an earned week toward the trajectory target", () => {
    const earned = ceiling({ previousDecision: "PROGRESS", trajectoryTargetKm: 21.8 });
    expect(earned).toBeCloseTo(21.8, 1);
    expect(earned).toBeGreaterThan(ceiling({ previousDecision: "PROGRESS", trajectoryTargetKm: null }));
  });

  it("never lets the trajectory push past the +10% safety ceiling", () => {
    expect(ceiling({ previousDecision: "PROGRESS", trajectoryTargetKm: 500 })).toBeCloseTo(22, 1);
  });

  it("never lets the trajectory pull an earned week backwards", () => {
    expect(ceiling({ previousDecision: "PROGRESS", trajectoryTargetKm: 5 })).toBeCloseTo(21, 1);
  });

  it("does not let the trajectory undo a deload or a fatigue cut", () => {
    expect(ceiling({ previousDecision: "DELOAD", trajectoryTargetKm: 40 })).toBeCloseTo(16, 1);
    expect(ceiling({ previousDecision: "PROGRESS", tsb: -25, trajectoryTargetKm: 40 })).toBeCloseTo(18, 1);
  });

  it("never chases the trajectory during a taper", () => {
    expect(
      ceiling({ trainingPhase: "taper", previousDecision: "PROGRESS", trajectoryTargetKm: 40 }),
    ).toBeCloseTo(15, 1);
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

  it("does not infer gym readiness from whole-program load alone", () => {
    const plan = buildWeekTemplate(baseInput({ totalTsb: -30, strengthDays: [0], lowerBodyStrengthDays: [0] }));
    const gym = plan.support_sessions.find((s) => s.title === "Lower-body strength");
    expect(gym?.description).toContain("report unusual leg soreness");
    expect(gym?.description).not.toContain("cut volume");
  });
});
