import { describe, expect, it } from "vitest";
import {
  estimateThreshold,
  findSteadyEffort,
  MIN_EFFORTS_TO_UPDATE,
  STEADY_WINDOW_S,
  type SteadyEffort,
} from "./thresholdEvidence.js";

const EASY_CEILING = 159; // Juan: 79% of 201
const HR_MAX = 201; // percentage threshold: 177

/** 1-second samples; `hrAt(t)` gives heart rate at second t; ~3 m/s. */
function stream(seconds: number, hrAt: (t: number) => number | null) {
  const timeS = Array.from({ length: seconds }, (_, i) => i);
  return { timeS, distanceM: timeS.map((t) => t * 2.9), heartrate: timeS.map(hrAt) };
}

describe("findSteadyEffort", () => {
  it("finds a steady tempo block — Juan's run with a friend, Oct 1", () => {
    // 6 min warm-up at 140, then 24 min held around 173-175.
    const e = findSteadyEffort(stream(30 * 60, (t) => (t < 360 ? 140 : 173 + (t % 3))), EASY_CEILING);
    expect(e).not.toBeNull();
    expect(e!.avgHr).toBeGreaterThan(172);
    expect(e!.durationS).toBeGreaterThanOrEqual(STEADY_WINDOW_S);
    expect(Math.abs(e!.drift)).toBeLessThan(0.05);
  });

  it("rejects a block whose heart rate keeps climbing — that is above threshold", () => {
    // 150 → 185 over 25 minutes: drift far beyond 5%.
    const e = findSteadyEffort(stream(25 * 60, (t) => 150 + (35 * t) / (25 * 60)), EASY_CEILING);
    expect(e).toBeNull();
  });

  it("rejects an easy run, however long", () => {
    expect(findSteadyEffort(stream(60 * 60, () => 145), EASY_CEILING)).toBeNull();
  });

  it("rejects a run with too little time above the easy ceiling — e.g. a hilly easy run", () => {
    // Alternating 2 min at 150 / 1 min at 168: only a third above the ceiling.
    const e = findSteadyEffort(stream(40 * 60, (t) => (Math.floor(t / 60) % 3 === 2 ? 168 : 150)), EASY_CEILING);
    expect(e).toBeNull();
  });

  it("needs a full 20 minutes", () => {
    expect(findSteadyEffort(stream(19 * 60, () => 175), EASY_CEILING)).toBeNull();
  });

  it("does not trust a window riddled with dropouts", () => {
    const e = findSteadyEffort(stream(30 * 60, (t) => (t % 4 === 0 ? 175 : null)), EASY_CEILING);
    expect(e).toBeNull();
  });
});

const effort = (avgHr: number): SteadyEffort => ({ durationS: 1200, avgHr, paceSecPerKm: 345, drift: 0.02 });

describe("estimateThreshold — a lower bound that can only raise the estimate", () => {
  it("keeps the percentage rule on a single effort, and says how many more are needed", () => {
    const t = estimateThreshold(HR_MAX, [effort(185)]);
    expect(t.source).toBe("percent");
    expect(t.thresholdHr).toBe(177);
    expect(t.lowerBound).toBeNull();
    expect(t.effortsNeeded).toBe(MIN_EFFORTS_TO_UPDATE - 1);
  });

  it("uses the bound BOTH efforts cleared — a single glitchy high run cannot move it", () => {
    const t = estimateThreshold(HR_MAX, [effort(195), effort(181)]);
    expect(t.lowerBound).toBe(181);
    expect(t.thresholdHr).toBe(181);
    expect(t.source).toBe("measured");
  });

  it("never LOWERS the estimate: efforts held below it are consistent, not contradictory", () => {
    // Two efforts at ~175, under the 177 rule — exactly where Juan's evidence points.
    const t = estimateThreshold(HR_MAX, [effort(175.4), effort(174.8)]);
    expect(t.lowerBound).toBe(174);
    expect(t.thresholdHr).toBe(177);
    expect(t.source).toBe("percent");
  });

  it("reports nothing measured with no efforts at all", () => {
    const t = estimateThreshold(HR_MAX, []);
    expect(t.efforts).toEqual([]);
    expect(t.thresholdHr).toBe(177);
    expect(t.effortsNeeded).toBe(MIN_EFFORTS_TO_UPDATE);
  });
});
