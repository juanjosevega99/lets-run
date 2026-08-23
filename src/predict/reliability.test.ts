import { describe, expect, it } from "vitest";
import {
  estimateReliability,
  RELIABILITY_CTL_FLOOR,
  RELIABILITY_CTL_MARGIN,
  RELIABILITY_MAX_EXTRAPOLATION,
} from "./reliability.js";

describe("estimateReliability", () => {
  it("withholds when running CTL is at or below the bridge-saturation floor (today's real state)", () => {
    const r = estimateReliability({ runningCtl: 0.6, runs28d: 0, daysSinceLastRun: 82 });
    expect(r.reliable).toBe(false);
    expect(r.reason).toContain("CTL 0.6");
  });

  it("requires CTL to clear the floor by a margin, not squeak past it (boundary)", () => {
    // Previously `+0.1` counted as reliable. That is what unpaused the 1:48:29 estimate
    // at CTL 5.10 — a bridge still pinned to its clamp. The margin closes that.
    expect(estimateReliability({ runningCtl: RELIABILITY_CTL_FLOOR, runs28d: 10, daysSinceLastRun: 2 }).reliable).toBe(
      false,
    );
    expect(
      estimateReliability({ runningCtl: RELIABILITY_CTL_FLOOR + 0.1, runs28d: 10, daysSinceLastRun: 2 }).reliable,
    ).toBe(false);
    expect(
      estimateReliability({
        runningCtl: RELIABILITY_CTL_FLOOR + RELIABILITY_CTL_MARGIN + 0.1,
        runs28d: 10,
        daysSinceLastRun: 2,
      }).reliable,
    ).toBe(true);
  });

  it("withholds when there are no runs in 28 days even if CTL is unknown", () => {
    const r = estimateReliability({ runningCtl: null, runs28d: 0, daysSinceLastRun: null });
    expect(r.reliable).toBe(false);
    expect(r.reason).toContain("28 days");
  });

  it("withholds when the last run is more than 28 days ago", () => {
    const r = estimateReliability({ runningCtl: 20, runs28d: 3, daysSinceLastRun: 40 });
    expect(r.reliable).toBe(false);
    expect(r.reason).toContain("40 days");
  });

  it("is reliable when running fitness is present and recent", () => {
    const r = estimateReliability({ runningCtl: 35, runs28d: 12, daysSinceLastRun: 1 });
    expect(r.reliable).toBe(true);
  });
});

describe("estimateReliability — distance extrapolation guard", () => {
  // Healthy recent running, so only the distance check can fail.
  const trained = { runningCtl: 30, runs28d: 12, daysSinceLastRun: 1 };

  it("withholds a half-marathon estimate built on a 5km longest run", () => {
    // The real 2026-08-23 case: CTL had just cleared the floor, so the estimate
    // unpaused and printed 1:48:29 (5:08/km) off a 4.97km longest run — 4.2x.
    const r = estimateReliability({ ...trained, longestRecentRunM: 4970, raceDistanceM: 21100 });
    expect(r.reliable).toBe(false);
    expect(r.reason).toContain("4.2x");
    expect(r.reason).toContain("5.0km");
  });

  it("allows the estimate once the longest run is within the model's range", () => {
    // 21.1km from 8km is 2.6x — inside the bound.
    expect(estimateReliability({ ...trained, longestRecentRunM: 8000, raceDistanceM: 21100 }).reliable).toBe(true);
  });

  it("treats the bound as exclusive", () => {
    const atBound = 21100 / RELIABILITY_MAX_EXTRAPOLATION;
    expect(estimateReliability({ ...trained, longestRecentRunM: atBound, raceDistanceM: 21100 }).reliable).toBe(true);
    expect(
      estimateReliability({ ...trained, longestRecentRunM: atBound - 200, raceDistanceM: 21100 }).reliable,
    ).toBe(false);
  });

  it("skips the check when either distance is unknown", () => {
    expect(estimateReliability({ ...trained, longestRecentRunM: null, raceDistanceM: 21100 }).reliable).toBe(true);
    expect(estimateReliability({ ...trained, longestRecentRunM: 4970, raceDistanceM: null }).reliable).toBe(true);
    expect(estimateReliability(trained).reliable).toBe(true);
  });
});

describe("estimateReliability — CTL must clear the clamp with margin", () => {
  const rest = { runs28d: 12, daysSinceLastRun: 1, longestRecentRunM: 8000, raceDistanceM: 21100 };

  it("still withholds just above the bare floor, where the bridge is saturated", () => {
    // CTL 5.10 vs a floor of 5 passed the old strict `<=` and unpaused the estimate.
    expect(estimateReliability({ ...rest, runningCtl: 5.1 }).reliable).toBe(false);
    expect(estimateReliability({ ...rest, runningCtl: 6.4 }).reliable).toBe(false);
  });

  it("allows it once CTL is clear of the clamp", () => {
    expect(estimateReliability({ ...rest, runningCtl: 8 }).reliable).toBe(true);
  });
});
