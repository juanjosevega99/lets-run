import { describe, expect, it } from "vitest";
import { validateWeek, type PlannedSession } from "./validator.js";

const easy = (day: number, km: number): PlannedSession => ({
  day,
  title: "easy",
  intensity: "low",
  plannedKm: km,
});

// legal baseline: 40km, 87.5% low, one quality day, two full rest days
const legalWeek: PlannedSession[] = [
  easy(0, 8),
  { day: 1, title: "threshold", intensity: "high", plannedKm: 5 },
  easy(2, 8),
  easy(4, 7),
  easy(6, 12),
];

describe("validateWeek (S2 hard rules)", () => {
  it("passes a legal week with zero violations", () => {
    expect(validateWeek({ sessions: legalWeek, previousWeekKm: 38 })).toEqual([]);
  });

  it("rejects >10% weekly volume progression", () => {
    const v = validateWeek({ sessions: legalWeek, previousWeekKm: 30 }); // 40 > 33
    expect(v.map((x) => x.rule)).toContain("volume_progression");
  });

  it("honors a stricter deterministic running-volume ceiling", () => {
    const v = validateWeek({ sessions: legalWeek, previousWeekKm: 38, maxPlannedRunKm: 39 });
    expect(v.map((x) => x.rule)).toContain("volume_progression");
  });

  it("skips the progression rule without a baseline week", () => {
    expect(validateWeek({ sessions: legalWeek, previousWeekKm: null })).toEqual([]);
  });

  it("rejects a week with no full rest day", () => {
    const everyDay = [0, 1, 2, 3, 4, 5, 6].map((d) => easy(d, 5));
    const v = validateWeek({ sessions: everyDay, previousWeekKm: null });
    expect(v.map((x) => x.rule)).toContain("rest_day");
  });

  it("rejects < 75% low-intensity volume", () => {
    const v = validateWeek({
      sessions: [easy(0, 10), { day: 2, title: "intervals", intensity: "high", plannedKm: 10 }],
      previousWeekKm: null,
    });
    expect(v.map((x) => x.rule)).toContain("polarized");
  });

  it("rejects high-intensity sessions on consecutive days", () => {
    const v = validateWeek({
      sessions: [
        { day: 1, title: "intervals", intensity: "high", plannedKm: 4 },
        { day: 2, title: "tempo", intensity: "high", plannedKm: 4 },
        easy(0, 12),
        easy(4, 12),
        easy(6, 12),
      ],
      previousWeekKm: null,
    });
    expect(v.map((x) => x.rule)).toContain("consecutive_high");
  });

  it.each([
    { label: "negative", plannedKm: -1 },
    { label: "NaN", plannedKm: Number.NaN },
    { label: "positive infinity", plannedKm: Number.POSITIVE_INFINITY },
    { label: "negative infinity", plannedKm: Number.NEGATIVE_INFINITY },
  ])("rejects $label planned distance without poisoning the remaining checks", ({ plannedKm }) => {
    const v = validateWeek({
      sessions: [{ day: 0, title: "invalid distance", intensity: "low", plannedKm }, easy(2, 5)],
      previousWeekKm: null,
    });
    expect(v.filter((x) => x.rule === "invalid_planned_km")).toHaveLength(1);
  });

  it.each([-1, 7, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid day %s", (day) => {
    const v = validateWeek({ sessions: [easy(day, 5)], previousWeekKm: null });
    expect(v.filter((x) => x.rule === "invalid_day")).toHaveLength(1);
  });

  it("rejects a rest-labeled session with positive distance", () => {
    const v = validateWeek({
      sessions: [{ day: 1, title: "Rest", intensity: "rest", plannedKm: 5 }],
      previousWeekKm: null,
    });
    expect(v.map((x) => x.rule)).toContain("rest_session_distance");
  });

  it("rejects a day declared as rest that also contains high-intensity work", () => {
    const v = validateWeek({
      sessions: [
        { day: 1, title: "Rest", intensity: "rest", plannedKm: 0 },
        { day: 1, title: "Intervals", intensity: "high", plannedKm: 4 },
        easy(3, 12),
      ],
      previousWeekKm: null,
    });
    const conflict = v.find((x) => x.rule === "rest_day_conflict");
    expect(conflict?.detail).toContain("Intervals (high)");
  });

  it("reports multiple violations at once (the LLM gets the full list to fix)", () => {
    const v = validateWeek({
      sessions: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        day: d,
        title: "hammer",
        intensity: "high" as const,
        plannedKm: 10,
      })),
      previousWeekKm: 30,
    });
    const rules = v.map((x) => x.rule);
    expect(rules).toContain("volume_progression");
    expect(rules).toContain("rest_day");
    expect(rules).toContain("polarized");
    expect(rules).toContain("consecutive_high");
  });

  it("gates return-to-run frequency, effort, spacing, and single-run spikes", () => {
    const v = validateWeek({
      sessions: [
        easy(0, 3),
        { day: 1, title: "tempo", intensity: "high", plannedKm: 6 },
        easy(2, 3),
        easy(4, 3),
      ],
      previousWeekKm: null,
      trainingPhase: "return_to_run",
      longestRunKm30d: 4,
    });
    const rules = v.map((x) => x.rule);
    expect(rules).toContain("return_to_run_frequency");
    expect(rules).toContain("return_to_run_intensity");
    expect(rules).toContain("return_to_run_spacing");
    expect(rules).toContain("single_run_spike");
  });

  it("rejects high-intensity zero-distance cross-training during return-to-run", () => {
    const v = validateWeek({
      sessions: [
        easy(0, 3),
        easy(2, 3),
        easy(5, 4),
        { day: 3, title: "Hard bike", intensity: "high", plannedKm: 0 },
      ],
      previousWeekKm: null,
      trainingPhase: "return_to_run",
      longestRunKm30d: 4,
    });
    expect(v.map((x) => x.rule)).toContain("return_to_run_intensity");
  });

  it("rejects lower-body strength on or immediately before the key run", () => {
    const v = validateWeek({
      sessions: legalWeek,
      previousWeekKm: null,
      keySessionDay: 6,
      lowerBodyStrengthDays: [5],
    });
    expect(v.map((x) => x.rule)).toContain("lower_body_before_key");
  });

  it("counts Sunday lower-body as immediately before a Monday key run (wraparound, red-team M3)", () => {
    const v = validateWeek({
      sessions: legalWeek,
      previousWeekKm: null,
      keySessionDay: 0, // Monday
      lowerBodyStrengthDays: [6], // Sunday — the old keyDay-1 guard missed this
    });
    expect(v.map((x) => x.rule)).toContain("lower_body_before_key");
  });

  it("requires configured strength days to retain an actual gym session", () => {
    const withGym = [...legalWeek, { day: 3, title: "Strength training", intensity: "low" as const, plannedKm: 0 }];
    expect(validateWeek({ sessions: withGym, previousWeekKm: null, requiredStrengthDays: [3] })).toEqual([]);
    const missing = validateWeek({ sessions: withGym, previousWeekKm: null, requiredStrengthDays: [5] });
    expect(missing.map((x) => x.rule)).toContain("missing_strength_day");
  });
});
