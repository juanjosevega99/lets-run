import { describe, expect, it } from "vitest";
import { estimateInjuryRisk, ACWR_CHRONIC_FLOOR } from "./injuryRisk.js";

describe("estimateInjuryRisk (ACWR)", () => {
  it("withholds the ratio while the athlete is still building a base", () => {
    // Detrained comeback: chronic running load near zero would make ATL/CTL explode.
    const r = estimateInjuryRisk({ acuteLoad: 3, chronicLoad: 2 });
    expect(r.level).toBe("building_base");
    expect(r.ratio).toBeNull();
    expect(r.headline).toBe("Building base");
  });

  it("treats the chronic floor as exclusive (exactly at the floor is still building)", () => {
    expect(estimateInjuryRisk({ acuteLoad: 4, chronicLoad: ACWR_CHRONIC_FLOOR }).level).toBe("building_base");
    expect(estimateInjuryRisk({ acuteLoad: 20, chronicLoad: ACWR_CHRONIC_FLOOR + 0.1 }).level).not.toBe(
      "building_base",
    );
  });

  it("calls the 0.8–1.3 sweet spot optimal", () => {
    expect(estimateInjuryRisk({ acuteLoad: 40, chronicLoad: 40 }).level).toBe("optimal"); // 1.0
    expect(estimateInjuryRisk({ acuteLoad: 32, chronicLoad: 40 }).level).toBe("optimal"); // 0.8
    expect(estimateInjuryRisk({ acuteLoad: 52, chronicLoad: 40 }).level).toBe("optimal"); // 1.3
  });

  it("flags below-baseline load as low, not risky", () => {
    const r = estimateInjuryRisk({ acuteLoad: 20, chronicLoad: 40 }); // 0.5
    expect(r.level).toBe("low");
    expect(r.ratio).toBeCloseTo(0.5);
  });

  it("separates elevated (1.3–1.5) from high (>1.5)", () => {
    expect(estimateInjuryRisk({ acuteLoad: 56, chronicLoad: 40 }).level).toBe("elevated"); // 1.4
    expect(estimateInjuryRisk({ acuteLoad: 64, chronicLoad: 40 }).level).toBe("high"); // 1.6
  });

  it("surfaces the ratio in the explanation so the band is auditable", () => {
    const r = estimateInjuryRisk({ acuteLoad: 64, chronicLoad: 40 });
    expect(r.reason).toContain("1.60");
  });
});
