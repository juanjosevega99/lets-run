import { describe, expect, it } from "vitest";
import { signedErrorPct, summarize, quantile } from "./metrics.js";

describe("signedErrorPct", () => {
  it("is positive when predicted slower than actual", () => {
    expect(signedErrorPct(110, 100)).toBeCloseTo(10);
  });
  it("is negative when predicted faster than actual", () => {
    expect(signedErrorPct(95, 100)).toBeCloseTo(-5);
  });
  it("rejects a non-positive actual", () => {
    expect(() => signedErrorPct(100, 0)).toThrow(/positive/);
  });
});

describe("quantile", () => {
  it("interpolates linearly", () => {
    expect(quantile([0, 10], 0.5)).toBe(5);
    expect(quantile([0, 10, 20, 30, 40], 0.25)).toBe(10);
  });
  it("handles exact positions and extremes", () => {
    expect(quantile([1, 2, 3], 0)).toBe(1);
    expect(quantile([1, 2, 3], 1)).toBe(3);
    expect(quantile([7], 0.5)).toBe(7);
  });
  it("rejects empty input and out-of-range q", () => {
    expect(() => quantile([], 0.5)).toThrow(/empty/);
    expect(() => quantile([1], 1.5)).toThrow(/\[0,1\]/);
  });
});

describe("summarize", () => {
  it("computes MAE, bias, and quantiles over signed errors", () => {
    // errors: -4, -2, 0, +2, +4 → MAE 2.4, bias 0
    const s = summarize([-4, -2, 0, 2, 4]);
    expect(s.n).toBe(5);
    expect(s.maePct).toBeCloseTo(2.4);
    expect(s.biasPct).toBeCloseTo(0);
    expect(s.p50).toBeCloseTo(0);
    expect(s.p10).toBeCloseTo(-3.2);
    expect(s.p90).toBeCloseTo(3.2);
  });
  it("separates MAE from bias for a systematically slow predictor", () => {
    const s = summarize([3, 5, 4]);
    expect(s.maePct).toBeCloseTo(4);
    expect(s.biasPct).toBeCloseTo(4); // all-positive: bias equals MAE
  });
  it("rejects an empty error list", () => {
    expect(() => summarize([])).toThrow(/zero/);
  });
});
