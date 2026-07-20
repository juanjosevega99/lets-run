import { describe, expect, it } from "vitest";
import { estimateReliability, RELIABILITY_CTL_FLOOR } from "./reliability.js";

describe("estimateReliability", () => {
  it("withholds when running CTL is at or below the bridge-saturation floor (today's real state)", () => {
    const r = estimateReliability({ runningCtl: 0.6, runs28d: 0, daysSinceLastRun: 82 });
    expect(r.reliable).toBe(false);
    expect(r.reason).toContain("CTL 0.6");
  });

  it("treats the exact floor as unreliable (boundary)", () => {
    expect(estimateReliability({ runningCtl: RELIABILITY_CTL_FLOOR, runs28d: 10, daysSinceLastRun: 2 }).reliable).toBe(
      false,
    );
    expect(estimateReliability({ runningCtl: RELIABILITY_CTL_FLOOR + 0.1, runs28d: 10, daysSinceLastRun: 2 }).reliable).toBe(
      true,
    );
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
