import { describe, expect, it } from "vitest";
import {
  MAX_LONG_RUN_SHARE_OF_WEEK,
  SAFE_WEEKLY_GROWTH,
  raceTrajectory,
  type TrajectoryInput,
} from "./trajectory.js";

const HALF_KM = 21.0975;

function input(over: Partial<TrajectoryInput> = {}): TrajectoryInput {
  return { raceKm: HALF_KM, weeksToRace: 33, currentWeeklyKm: 9, currentLongestRunKm: 5.6, ...over };
}

describe("raceTrajectory — the peak the race actually asks for", () => {
  it("rehearses the full half-marathon distance and sizes the week around it", () => {
    const t = raceTrajectory(input());
    expect(t.peakLongRunKm).toBeCloseTo(21.1, 1);
    expect(t.peakWeeklyKm).toBeCloseTo(21.1 / MAX_LONG_RUN_SHARE_OF_WEEK, 0);
  });

  it("excludes the taper and the down weeks from the weeks that can carry growth", () => {
    // 33 weeks - 3 taper = 30 calendar weeks, of which one in four is a down week.
    expect(raceTrajectory(input()).growthWeeks).toBeCloseTo(22.5, 1);
  });
});

describe("raceTrajectory — required rate and slack", () => {
  it("computes a compounding rate that actually reaches the peak", () => {
    const t = raceTrajectory(input());
    const reached = 9 * Math.pow(1 + t.requiredWeeklyGrowth!, t.growthWeeks);
    expect(reached).toBeCloseTo(t.peakWeeklyKm, 1);
  });

  it("puts Juan's real position just inside the safe ceiling", () => {
    const t = raceTrajectory(input());
    expect(t.requiredWeeklyGrowth!).toBeLessThan(SAFE_WEEKLY_GROWTH);
    expect(t.requiredWeeklyGrowth!).toBeGreaterThan(0.03);
    expect(t.slackWeeks!).toBeGreaterThan(0);
  });

  it("spends slack as weeks pass without training", () => {
    const early = raceTrajectory(input({ weeksToRace: 33 }));
    const later = raceTrajectory(input({ weeksToRace: 28 }));
    expect(later.slackWeeks!).toBeLessThan(early.slackWeeks!);
    expect(later.requiredWeeklyGrowth!).toBeGreaterThan(early.requiredWeeklyGrowth!);
  });

  it("calls the goal unreachable once it needs more than +10% a week", () => {
    const t = raceTrajectory(input({ weeksToRace: 10, currentWeeklyKm: 9 }));
    expect(t.status).toBe("unreachable");
    expect(t.requiredWeeklyGrowth!).toBeGreaterThan(SAFE_WEEKLY_GROWTH);
    expect(t.headline).toContain("has to move");
  });

  it("escalates status as the margin disappears", () => {
    expect(raceTrajectory(input({ weeksToRace: 52 })).status).toBe("on_track");
    expect(raceTrajectory(input({ weeksToRace: 30 })).status).toBe("tight");
    expect(raceTrajectory(input({ weeksToRace: 29 })).status).toBe("at_risk");
    expect(raceTrajectory(input({ weeksToRace: 20 })).status).toBe("unreachable");
  });

  it("targets this week just above the current baseline, never past the peak", () => {
    const t = raceTrajectory(input());
    expect(t.thisWeekTargetKm!).toBeGreaterThan(9);
    expect(t.thisWeekTargetKm!).toBeLessThan(11);
    expect(raceTrajectory(input({ currentWeeklyKm: 52 })).thisWeekTargetKm!).toBeLessThanOrEqual(
      raceTrajectory(input()).peakWeeklyKm,
    );
  });
});

describe("raceTrajectory — edges that must not produce nonsense", () => {
  it("refuses to compound from a zero baseline", () => {
    const t = raceTrajectory(input({ currentWeeklyKm: 0 }));
    expect(t.status).toBe("no_baseline");
    expect(t.requiredWeeklyGrowth).toBeNull();
    expect(t.headline).not.toContain("Infinity");
    expect(t.headline).not.toContain("NaN");
  });

  it("stops planning growth inside the taper", () => {
    const t = raceTrajectory(input({ weeksToRace: 2 }));
    expect(t.status).toBe("taper");
    expect(t.growthWeeks).toBe(0);
    expect(t.thisWeekTargetKm).toBeNull();
  });

  it("reports arrival instead of demanding more once the peak is reached", () => {
    const t = raceTrajectory(input({ currentWeeklyKm: 60 }));
    expect(t.status).toBe("arrived");
    expect(t.requiredWeeklyGrowth).toBe(0);
  });

  it("tracks the long run separately, and it grows slower than weekly volume", () => {
    const t = raceTrajectory(input());
    expect(t.requiredLongRunGrowth!).toBeGreaterThan(0);
    expect(t.requiredLongRunGrowth!).toBeLessThan(SAFE_WEEKLY_GROWTH);
  });

  it("leaves the long-run rate unknown rather than guessing with no recent long run", () => {
    expect(raceTrajectory(input({ currentLongestRunKm: 0 })).requiredLongRunGrowth).toBeNull();
  });
});
