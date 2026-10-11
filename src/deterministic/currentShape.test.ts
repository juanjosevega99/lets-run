import { describe, expect, it } from "vitest";
import { currentShapeBound, MAX_NET_DESCENT_M, vdotFromThresholdPace } from "./currentShape.js";
import { predictTimeS, trainingPaces } from "./vdot.js";
import type { SteadyEffort } from "./thresholdEvidence.js";

const HALF = 21097.5;
const COURSE = 1.048; // 250 m gain + trail surface
const effort = (paceSecPerKm: number, over: Partial<SteadyEffort> = {}): SteadyEffort => ({
  durationS: 1200, avgHr: 175, paceSecPerKm, drift: 0.02, date: "2026-10-01", ...over,
});

describe("vdotFromThresholdPace", () => {
  it("inverts Daniels' threshold pace", () => {
    for (const vdot of [30, 36, 45, 55]) {
      expect(vdotFromThresholdPace(trainingPaces(vdot).thresholdSecPerKm)).toBeCloseTo(vdot, 2);
    }
  });

  it("gives a higher VDOT for a faster threshold pace", () => {
    expect(vdotFromThresholdPace(300)).toBeGreaterThan(vdotFromThresholdPace(345));
  });
});

describe("currentShapeBound — a time he would run no slower than", () => {
  it("Juan, Oct 1: 20 min steady at 5:45/km → about 2:10 on the Huemul course", () => {
    const b = currentShapeBound([effort(345)], HALF, COURSE)!;
    expect(b.vdotAtLeast).toBeGreaterThan(34.9);
    expect(b.vdotAtLeast).toBeLessThan(35.4);
    expect(b.timeAtMostS).toBeGreaterThan(2 * 3600 + 8 * 60);
    expect(b.timeAtMostS).toBeLessThan(2 * 3600 + 11 * 60);
  });

  it("is far slower than the stale 2019-anchored 1:42 — the number it replaces", () => {
    expect(currentShapeBound([effort(345)], HALF, COURSE)!.timeAtMostS).toBeGreaterThan(102 * 60 + 19);
  });

  it("uses the tightest bound available — the fastest steady effort", () => {
    const b = currentShapeBound([effort(345), effort(320), effort(360)], HALF, COURSE)!;
    expect(b.effort.paceSecPerKm).toBe(320);
  });

  it("fails safe on GPS: a watch reading short (slower pace) only loosens the bound", () => {
    const true_ = currentShapeBound([effort(335)], HALF, COURSE)!.timeAtMostS;
    const readShort = currentShapeBound([effort(345)], HALF, COURSE)!.timeAtMostS;
    expect(readShort).toBeGreaterThan(true_);
  });

  it("ignores a downhill window — it would flatter the pace", () => {
    expect(currentShapeBound([effort(300, { netElevationM: -(MAX_NET_DESCENT_M + 5) })], HALF, COURSE)).toBeNull();
    expect(currentShapeBound([effort(300, { netElevationM: 40 })], HALF, COURSE)).not.toBeNull();
  });

  it("applies the course multiplier", () => {
    const flat = currentShapeBound([effort(345)], HALF, 1)!;
    expect(flat.timeAtMostS).toBeCloseTo(predictTimeS(flat.vdotAtLeast, HALF), 0);
    expect(currentShapeBound([effort(345)], HALF, COURSE)!.timeAtMostS).toBeCloseTo(flat.timeAtMostS * COURSE, 0);
  });

  it("returns nothing without a usable effort", () => {
    expect(currentShapeBound([], HALF, COURSE)).toBeNull();
    expect(currentShapeBound([effort(345, { paceSecPerKm: null })], HALF, COURSE)).toBeNull();
  });
});
