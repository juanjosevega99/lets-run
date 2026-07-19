import { describe, expect, it } from "vitest";
import { findLimiter } from "./limiter.js";

const fit = { ctl: 50, peakCtl: 60, longestRunKm28d: 16, raceKm: 21.1, qualityShare28d: 0.15 };

describe("findLimiter (v1 heuristic)", () => {
  it("detrained athlete → aerobic base, regardless of everything else", () => {
    const r = findLimiter({ ...fit, ctl: 5, peakCtl: 70 });
    expect(r.limiter).toBe("aerobic_base");
    expect(r.reason).toContain("7%"); // 5/70 of peak
  });

  it("fit but no long runs → long endurance", () => {
    const r = findLimiter({ ...fit, longestRunKm28d: 8 });
    expect(r.limiter).toBe("long_endurance");
  });

  it("volume and long runs fine but no quality → threshold", () => {
    const r = findLimiter({ ...fit, qualityShare28d: 0.02 });
    expect(r.limiter).toBe("threshold");
  });

  it("everything in range → race specific", () => {
    expect(findLimiter(fit).limiter).toBe("race_specific");
  });

  it("no history (peak 0) skips the base rule instead of dividing by zero", () => {
    const r = findLimiter({ ...fit, ctl: 0, peakCtl: 0, longestRunKm28d: 0 });
    expect(r.limiter).toBe("long_endurance");
  });

  it("today's real case: CTL 0.6 vs peak ~70 → aerobic base", () => {
    const r = findLimiter({ ctl: 0.6, peakCtl: 70, longestRunKm28d: 0, raceKm: 21.1, qualityShare28d: 1 });
    expect(r.limiter).toBe("aerobic_base");
  });
});
