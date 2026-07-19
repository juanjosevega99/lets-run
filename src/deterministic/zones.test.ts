import { describe, expect, it } from "vitest";
import { hrZones, median } from "./zones.js";

describe("hrZones", () => {
  it("computes Daniels easy/threshold bands from max HR (Juan: 201)", () => {
    const z = hrZones({ hrMax: 201, hrRest: 55 });
    expect(z.easyFloor).toBe(131); // 65%
    expect(z.easyCeiling).toBe(159); // 79%
    expect(z.threshold).toBe(177); // 88%
  });

  it("puts his real observed easy runs inside the easy band, and the hard one outside", () => {
    const z = hrZones({ hrMax: 201, hrRest: 55 });
    // actual recent runs from his data
    for (const observedHr of [148, 151, 154, 155]) {
      expect(observedHr).toBeLessThanOrEqual(z.easyCeiling);
      expect(observedHr).toBeGreaterThanOrEqual(z.easyFloor);
    }
    // the 6:13/km run at 168 bpm was NOT easy — this is the bug the ceiling prevents
    expect(168).toBeGreaterThan(z.easyCeiling);
    // and 170+, which a 5:14/km prescription would have produced, is well past it
    expect(170).toBeGreaterThan(z.easyCeiling);
  });

  it("scales with a different athlete", () => {
    const z = hrZones({ hrMax: 180, hrRest: 50 });
    expect(z.easyCeiling).toBe(142);
  });
});

describe("median", () => {
  it("returns the middle value for odd counts and the mean of the middle two for even", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("is robust to a single wild outlier (why it's used over a mean)", () => {
    // one mis-recorded GPS run shouldn't move the prescribed easy pace
    expect(median([430, 435, 440, 445, 9999])).toBe(440);
  });

  it("returns null for an empty list", () => {
    expect(median([])).toBeNull();
  });
});
