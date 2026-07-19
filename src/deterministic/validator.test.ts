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
});
