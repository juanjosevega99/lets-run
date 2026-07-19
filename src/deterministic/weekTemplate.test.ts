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
    previousWeekKm: 20,
    tsb: -5,
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
  it("covers all 7 days exactly once across key + support sessions", () => {
    const plan = buildWeekTemplate(baseInput());
    const days = toSessions(plan).map((s) => s.day).sort((a, b) => a - b);
    expect(days).toEqual([0, 1, 2, 3, 4, 5, 6]);
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

  it("holds growth flat (no progression) when TSB is deeply negative, and never exceeds it", () => {
    const flat = buildWeekTemplate(baseInput({ previousWeekKm: 20, tsb: -25 }));
    const totalFlat = toSessions(flat).reduce((s, x) => s + x.plannedKm, 0);
    expect(totalFlat).toBeLessThanOrEqual(20);
    expect(totalFlat).toBeGreaterThan(19); // flooring loses a little, not much

    // less fatigued → the full +10% allowance, but per-session flooring means the
    // actual total is <= the cap, never over it (that's the property that matters —
    // see the exhaustive S2-validity matrix above for every limiter/tsb/volume combo)
    const normal = buildWeekTemplate(baseInput({ previousWeekKm: 20, tsb: 0 }));
    const totalNormal = toSessions(normal).reduce((s, x) => s + x.plannedKm, 0);
    expect(totalNormal).toBeLessThanOrEqual(22);
    expect(totalNormal).toBeGreaterThan(21);
  });

  it("starts at a conservative default when there is no volume baseline", () => {
    const plan = buildWeekTemplate(baseInput({ previousWeekKm: null, tsb: -25 })); // flat progression, isolates the default
    const total = toSessions(plan).reduce((s, x) => s + x.plannedKm, 0);
    expect(total).toBeLessThanOrEqual(12);
    expect(total).toBeGreaterThan(11);
  });

  it("includes real paces in session descriptions when available", () => {
    const plan = buildWeekTemplate(baseInput({ limiter: "aerobic_base", easyPaceSecPerKm: 360 }));
    expect(plan.key_session.description).toContain("6:00/km");
  });

  it("leads with the HR ceiling and demotes pace to a guide when HR data exists", () => {
    const plan = buildWeekTemplate(
      baseInput({ limiter: "aerobic_base", easyPaceSecPerKm: 435, easyHrCeiling: 159 }),
    );
    for (const s of [plan.key_session, ...plan.support_sessions.filter((x) => x.intensity === "low")]) {
      expect(s.description).toContain("HR under 159 bpm");
      expect(s.description).toContain("HR governs");
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

  it("explanation cites the limiter reason and is honest about being template-based", () => {
    const plan = buildWeekTemplate(baseInput({ limiterReason: "CTL is 1% of peak" }));
    expect(plan.explanation).toContain("no LLM call");
    expect(plan.explanation).toContain("CTL is 1% of peak");
  });
});
