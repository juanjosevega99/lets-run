import { describe, expect, it } from "vitest";
import { phaseRunDays, selectTrainingFocus, selectTrainingPhase } from "./trainingPhase.js";

describe("selectTrainingPhase", () => {
  it("puts an athlete with a long running gap into return-to-run regardless of the calendar", () => {
    expect(selectTrainingPhase({ daysToRace: 40, daysSinceLastRun: 81, runs28d: 0, activeRunWeeks4: 0 })).toBe(
      "return_to_run",
    );
  });

  it("requires several weeks of continuity before leaving return-to-run", () => {
    expect(selectTrainingPhase({ daysToRace: 250, daysSinceLastRun: 2, runs28d: 7, activeRunWeeks4: 3 })).toBe(
      "return_to_run",
    );
    expect(selectTrainingPhase({ daysToRace: 250, daysSinceLastRun: 2, runs28d: 9, activeRunWeeks4: 3 })).toBe("base");
  });

  it("moves through base, build, specific and taper from the race clock", () => {
    const ready = { daysSinceLastRun: 2, runs28d: 12, activeRunWeeks4: 4 };
    expect(selectTrainingPhase({ ...ready, daysToRace: 250 })).toBe("base");
    expect(selectTrainingPhase({ ...ready, daysToRace: 150 })).toBe("build");
    expect(selectTrainingPhase({ ...ready, daysToRace: 60 })).toBe("race_specific");
    expect(selectTrainingPhase({ ...ready, daysToRace: 10 })).toBe("taper");
  });
});

describe("selectTrainingFocus", () => {
  const common = {
    daysToRace: 150,
    daysSinceLastRun: 2,
    runs28d: 12,
    activeRunWeeks4: 4,
    longestRunKm30d: 14,
    raceKm: 21.1,
    qualityShare28d: 0.02,
  };

  it("makes return-to-run aerobic and explains the interruption", () => {
    const result = selectTrainingFocus({ ...common, phase: "return_to_run", daysSinceLastRun: 81 });
    expect(result.limiter).toBe("aerobic_base");
    expect(result.reason).toContain("81 days");
  });

  it("allows threshold to surface during build once long endurance exists", () => {
    expect(selectTrainingFocus({ ...common, phase: "build" }).limiter).toBe("threshold");
  });

  it("uses only three run days during return and taper", () => {
    expect(phaseRunDays("return_to_run")).toEqual([1, 3, 6]);
    expect(phaseRunDays("base")).toHaveLength(4);
    expect(phaseRunDays("taper")).toHaveLength(3);
  });

  it("moves the key run away from configured lower-body strength", () => {
    const days = phaseRunDays("return_to_run", [5]);
    expect(days).toHaveLength(3);
    expect(days.at(-1)).not.toBe(6);
    expect(days.every((day, i) => i === 0 || day - days[i - 1]! > 1)).toBe(true);
  });

  it("treats missing quality measurement as unknown, not zero", () => {
    const result = selectTrainingFocus({ ...common, phase: "build", qualityShare28d: null });
    expect(result.limiter).toBe("aerobic_base");
    expect(result.reason).toContain("unknown");
  });
});
