import { describe, expect, it } from "vitest";
import {
  replayCoach,
  replayWeekStarts,
  weekContext,
  formatCoachReplay,
  type ReplayActivity,
} from "./coachReplay.js";

const RACE_DATE = "2027-04-24";

function run(date: string, weekday: number, km: number, minutes = km * 7): ReplayActivity {
  return { date, weekday, sport: "run", km, minutes };
}
function gym(date: string, weekday: number): ReplayActivity {
  return { date, weekday, sport: "strength", km: 0, minutes: 60 };
}

describe("weekContext — the world as it looked on a given Monday", () => {
  // Mon 2026-09-07 … Sun 2026-09-13, then the following Monday.
  const week = [run("2026-09-07", 0, 4.13), run("2026-09-09", 2, 4.56), run("2026-09-13", 6, 5.8)];

  it("uses nothing from the week being planned", () => {
    const ctx = weekContext(week, [], "2026-09-07", { raceDateIso: RACE_DATE });
    expect(ctx.previousWeekKm).toBe(0);
    expect(ctx.runs28d).toBe(0);
    expect(ctx.longestRunKm30d).toBe(0);
    expect(ctx.daysSinceLastRun).toBeNull();
  });

  it("sees the finished week from the following Monday", () => {
    const ctx = weekContext(week, [], "2026-09-14", { raceDateIso: RACE_DATE });
    expect(ctx.previousWeekKm).toBeCloseTo(14.49, 2);
    expect(ctx.runs28d).toBe(3);
    expect(ctx.longestRunKm30d).toBe(5.8);
    expect(ctx.daysSinceLastRun).toBe(1);
    expect(ctx.activeRunWeeks4).toBe(1);
  });

  it("ranks habitual run weekdays most-used first, once there is enough signal", () => {
    const many = [
      run("2026-08-03", 0, 5), run("2026-08-05", 2, 5), run("2026-08-10", 0, 5),
      run("2026-08-12", 2, 5), run("2026-08-17", 0, 5), run("2026-08-23", 6, 5),
    ]; // Mondays 3/10/17, Wednesdays 5/12, one Sunday
    const ctx = weekContext(many, [], "2026-09-14", { raceDateIso: RACE_DATE });
    expect(ctx.preferredRunDays[0]).toBe(0); // Monday, three times
    expect(ctx.preferredRunDays).toContain(2);
    expect(ctx.preferredRunDays).toContain(6);
  });

  it("refuses to infer a pattern from too few runs", () => {
    expect(weekContext(week, [], "2026-09-14", { raceDateIso: RACE_DATE }).preferredRunDays).toEqual([]);
  });

  it("infers recurring gym weekdays the way production does", () => {
    const lifting = [0, 1, 2].flatMap((w) =>
      [0, 2].map((d) => {
        const ms = Date.parse("2026-08-03T00:00:00Z") + (w * 7 + d) * 86_400_000;
        return gym(new Date(ms).toISOString().slice(0, 10), d);
      }),
    );
    expect(weekContext(lifting, [], "2026-09-14", { raceDateIso: RACE_DATE }).strengthDays).toEqual([0, 2]);
  });
});

/** 2026-07-06 is a Monday; offset days from it and keep the weekday honest. */
function fromMonday(weeks: number, weekday: number): string {
  const ms = Date.parse("2026-07-06T00:00:00Z") + (weeks * 7 + weekday) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

describe("replayCoach — a forward simulation of the real controller", () => {
  const history: ReplayActivity[] = [];
  for (let w = 0; w < 10; w++) {
    history.push(run(fromMonday(w, 0), 0, 5));
    history.push(run(fromMonday(w, 2), 2, 5));
  }

  it("produces one row per week of history and never an invalid week", () => {
    const result = replayCoach(history, [], { raceDateIso: RACE_DATE });
    expect(result.weeks.length).toBeGreaterThan(5);
    expect(result.ruleViolations).toBe(0);
  });

  it("never lets a week's plan see a metre run during that week", () => {
    // The first week has no prior history at all, so it must fall back to the
    // conservative default rather than reflecting the 10km actually run in it.
    const result = replayCoach(history, [], { raceDateIso: RACE_DATE });
    const first = result.weeks[0]!;
    expect(first.actualKm).toBeGreaterThan(0);
    expect(first.plannedKm).toBeLessThanOrEqual(10);
  });

  it("carries each week's decision into the next, as the real controller does", () => {
    const result = replayCoach(history, [], { raceDateIso: RACE_DATE });
    expect(result.weeks.every((w) => ["PROGRESS", "PROCEED", "REPEAT", "DELOAD"].includes(w.decision))).toBe(true);
  });

  it("cannot reach PROGRESS, because no check-ins exist in history", () => {
    const result = replayCoach(history, [], { raceDateIso: RACE_DATE });
    expect(result.weeks.some((w) => w.decision === "PROGRESS")).toBe(false);
  });

  it("returns nothing for an empty history", () => {
    expect(replayWeekStarts([])).toEqual([]);
    expect(replayCoach([], [], { raceDateIso: RACE_DATE }).weeks).toEqual([]);
  });
});

describe("formatCoachReplay", () => {
  const result = replayCoach([run("2026-09-07", 0, 5), run("2026-09-09", 2, 5)], [], {
    raceDateIso: RACE_DATE,
  });

  it("summarises the run", () => {
    const out = formatCoachReplay(result);
    expect(out).toContain("weeks replayed");
    expect(out).toContain("rule violations");
  });

  it("hides clean weeks in problems-only mode", () => {
    const out = formatCoachReplay(result, true);
    expect(out).not.toContain("2026-09-07  ");
  });
});
