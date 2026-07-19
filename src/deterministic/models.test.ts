import { describe, expect, it } from "vitest";
import { riegelPredict, fitRiegelExponent, RIEGEL_DEFAULT_EXPONENT } from "./riegel.js";
import { vdotFromRace, predictTimeS, sustainableFraction, trainingPaces } from "./vdot.js";
import { costOfGrade, gapFactor, courseFactor } from "./minetti.js";
import { activityStress } from "./stress.js";
import { banisterSeries, fillDays } from "./banister.js";

describe("riegel", () => {
  it("extrapolates a 40:00 10K to ~1:28:15 for the half (published exponent)", () => {
    expect(riegelPredict(2400, 10000, 21097.5)).toBeCloseTo(5295, 0);
  });
  it("is identity at the same distance", () => {
    expect(riegelPredict(2400, 10000, 10000)).toBeCloseTo(2400);
  });
  it("recovers the exponent from a consistent race pair", () => {
    const b = fitRiegelExponent([
      { distanceM: 10000, timeS: 2400 },
      { distanceM: 21097.5, timeS: 5295 },
    ]);
    expect(b).toBeCloseTo(1.06, 2);
  });
  it("falls back to 1.06 with < 2 usable races and clamps absurd fits", () => {
    expect(fitRiegelExponent([{ distanceM: 10000, timeS: 2400 }])).toBe(RIEGEL_DEFAULT_EXPONENT);
    const clamped = fitRiegelExponent([
      { distanceM: 5000, timeS: 1500 },
      { distanceM: 10000, timeS: 4500 }, // catastrophic slowdown → raw b ≈ 1.58
    ]);
    expect(clamped).toBeLessThanOrEqual(1.15);
  });
  it("ignores near-equal-distance pairs (noise, not signal)", () => {
    const b = fitRiegelExponent([
      { distanceM: 21000, timeS: 5900 },
      { distanceM: 21097.5, timeS: 6000 }, // same-distance pair → excluded
    ]);
    expect(b).toBe(RIEGEL_DEFAULT_EXPONENT);
  });
});

describe("vdot (Daniels/Gilbert)", () => {
  it("rates a 40:00 10K at VDOT ≈ 52, matching the published tables", () => {
    expect(vdotFromRace(10000, 2400)).toBeGreaterThan(51.3);
    expect(vdotFromRace(10000, 2400)).toBeLessThan(52.6);
  });
  it("round-trips: predicting the same distance returns the same time", () => {
    const vdot = vdotFromRace(10000, 2400);
    expect(predictTimeS(vdot, 10000)).toBeCloseTo(2400, 0);
  });
  it("predicts a half from a 40:00 10K in the published 1:27:30–1:30 window", () => {
    const t = predictTimeS(vdotFromRace(10000, 2400), 21097.5);
    expect(t).toBeGreaterThan(5250);
    expect(t).toBeLessThan(5400);
  });
  it("sustainable fraction at 1 hour ≈ 88–89% of VO2max (the classic figure)", () => {
    expect(sustainableFraction(60)).toBeGreaterThan(0.883);
    expect(sustainableFraction(60)).toBeLessThan(0.893);
  });
  it("orders training paces correctly: easy slower than threshold slower than interval", () => {
    const p = trainingPaces(52);
    expect(p.easySecPerKm).toBeGreaterThan(p.marathonSecPerKm);
    expect(p.marathonSecPerKm).toBeGreaterThan(p.thresholdSecPerKm);
    expect(p.thresholdSecPerKm).toBeGreaterThan(p.intervalSecPerKm);
  });
});

describe("minetti", () => {
  it("matches the published polynomial at the level and ±10% grades", () => {
    expect(costOfGrade(0)).toBeCloseTo(3.6, 5);
    expect(costOfGrade(0.1)).toBeCloseTo(5.9681, 3);
    expect(costOfGrade(-0.1)).toBeCloseTo(2.1517, 3);
  });
  it("gap factor: ~1.66x cost at +10%, ~0.60x at −10%", () => {
    expect(gapFactor(0.1)).toBeCloseTo(1.6578, 3);
    expect(gapFactor(-0.1)).toBeCloseTo(0.5977, 3);
  });
  it("clamps outside the fitted ±45% grade range", () => {
    expect(costOfGrade(2)).toBeCloseTo(costOfGrade(0.45));
  });
  it("course factor: 250m of gain on a half costs under 1% (this is a fast course)", () => {
    const f = courseFactor(21097.5, 250);
    expect(f).toBeGreaterThan(1.004);
    expect(f).toBeLessThan(1.011);
  });
  it("course factor is 1 for a flat course", () => {
    expect(courseFactor(10000, 0)).toBe(1);
  });
});

describe("stress hierarchy", () => {
  const hr = { hrMax: 193, hrRest: 55 };
  it("level 1 — Banister TRIMP with HR: 60min @ avg 150 ≈ 99", () => {
    const r = activityStress(
      { sportType: "Run", movingTimeS: 3600, elapsedTimeS: null, distanceM: 12000, avgHr: 150 },
      hr,
      52,
    );
    expect(r.method).toBe("trimp");
    expect(r.stress).toBeCloseTo(99.1, 0);
  });
  it("level 2 — pace-based for HR-less runs, scaled by threshold velocity", () => {
    const r = activityStress(
      { sportType: "Run", movingTimeS: 3600, elapsedTimeS: null, distanceM: 12000, avgHr: null },
      hr,
      52,
    );
    expect(r.method).toBe("pace");
    expect(r.stress).toBeGreaterThan(60);
    expect(r.stress).toBeLessThan(80);
  });
  it("level 3 — flat rate for gym, so it loads fatigue without inventing fitness data", () => {
    const r = activityStress(
      { sportType: "Weight Training", movingTimeS: 3600, elapsedTimeS: null, distanceM: null, avgHr: null },
      hr,
      52,
    );
    expect(r.method).toBe("flat");
    expect(r.stress).toBe(30);
  });
  it("zero-duration activities contribute zero stress", () => {
    const r = activityStress(
      { sportType: "Run", movingTimeS: null, elapsedTimeS: null, distanceM: 5000, avgHr: 150 },
      hr,
      52,
    );
    expect(r.stress).toBe(0);
  });
});

describe("banister", () => {
  it("approaches the constant load asymptotically, ATL much faster than CTL", () => {
    const days = Array.from({ length: 200 }, (_, i) => ({
      day: `d${i}`,
      runningStress: 100,
      totalStress: 100,
    }));
    const series = banisterSeries(days);
    expect(series[0]!.ctl).toBeCloseTo(100 / 42, 3);
    expect(series[0]!.atl).toBeCloseTo(100 / 7, 3);
    expect(series[0]!.tsb).toBe(0);
    expect(series.at(-1)!.ctl).toBeGreaterThan(95);
    expect(series[13]!.atl).toBeGreaterThan(series[13]!.ctl); // fatigue leads early
  });
  it("TSB reflects form going into the day (yesterday's CTL − ATL)", () => {
    const series = banisterSeries([
      { day: "a", runningStress: 100, totalStress: 100 },
      { day: "b", runningStress: 0, totalStress: 0 },
    ]);
    expect(series[1]!.tsb).toBeCloseTo(100 / 42 - 100 / 7, 6); // negative: tired after day 1
  });
  it("gym loads fatigue but not running fitness (the §6 split)", () => {
    const series = banisterSeries([{ day: "a", runningStress: 0, totalStress: 80 }]);
    expect(series[0]!.ctl).toBe(0);
    expect(series[0]!.atl).toBeGreaterThan(0);
  });
  it("fillDays zero-fills gaps so detraining actually decays", () => {
    const loads = new Map([
      ["2026-01-01", { runningStress: 50, totalStress: 50 }],
      ["2026-01-04", { runningStress: 50, totalStress: 50 }],
    ]);
    const days = fillDays(loads, "2026-01-01", "2026-01-05");
    expect(days).toHaveLength(5);
    expect(days[1]!.totalStress).toBe(0);
    expect(days[3]!.runningStress).toBe(50);
  });
});
