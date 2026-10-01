import { describe, expect, it } from "vitest";
import {
  classifyFromAverage,
  classifyFromTotals,
  classifyRunIntensity,
  combinedEasyShare,
  MIN_MEASURED_SECONDS,
} from "./runIntensity.js";
import { emptyZoneTotals, type ZoneTotals } from "./zoneTime.js";
import { hrBands } from "./zones.js";

const PROFILE = { hrMax: 201, hrRest: 55 }; // easy ceiling 159, threshold 177

/** Build zone totals from minutes per band. */
function totals(recovery: number, easy: number, moderate: number, threshold: number): ZoneTotals {
  const t = emptyZoneTotals();
  t.recovery.seconds = recovery * 60;
  t.easy.seconds = easy * 60;
  t.moderate.seconds = moderate * 60;
  t.threshold.seconds = threshold * 60;
  return t;
}

describe("classifyFromTotals — Juan's three reference runs", () => {
  it("2026-09-28: 45 min, 100% under the ceiling → easy", () => {
    const r = classifyFromTotals(totals(5, 40, 0, 0));
    expect(r.label).toBe("easy");
    expect(r.easyShare).toBeCloseTo(1, 5);
  });

  it("2026-09-15: hilly, a third above the ceiling → moderate, not hard", () => {
    expect(classifyFromTotals(totals(2, 23, 12, 0)).label).toBe("moderate");
  });

  it("2026-10-01: prescribed 20 min easy, run as a 40-min tempo with a friend → hard", () => {
    // easy 15% · moderate 70% · threshold 15%
    const r = classifyFromTotals(totals(0, 6, 28, 6));
    expect(r.label).toBe("hard");
    expect(r.easyShare).toBeCloseTo(0.15, 2);
  });
});

describe("classifyFromTotals — boundaries", () => {
  it("calls a run hard once half of it sat above easy", () => {
    expect(classifyFromTotals(totals(0, 15, 15, 0)).label).toBe("hard");
    expect(classifyFromTotals(totals(0, 16, 14, 0)).label).toBe("moderate");
  });

  it("calls a run hard once a fifth of it reached threshold, even if the rest was easy", () => {
    expect(classifyFromTotals(totals(0, 24, 0, 6)).label).toBe("hard");
  });

  it("needs 80% easy to call a run easy — the same target the zones view uses", () => {
    expect(classifyFromTotals(totals(0, 24, 6, 0)).label).toBe("easy");
    expect(classifyFromTotals(totals(0, 23, 7, 0)).label).toBe("moderate");
  });

  it("refuses to judge a run with almost no HR data", () => {
    const r = classifyFromTotals(totals(0, (MIN_MEASURED_SECONDS - 1) / 60, 0, 0));
    expect(r.label).toBe("unknown");
    expect(r.easyShare).toBeNull();
  });
});

describe("classifyRunIntensity — from a raw stream", () => {
  it("bins samples with the dashboard's own bands", () => {
    const n = 600; // 10s samples, 100 minutes
    const timeS = Array.from({ length: n }, (_, i) => i * 10);
    const distanceM = timeS.map((t) => t * 2.5);
    const heartrate = timeS.map((_, i) => (i < n * 0.9 ? 145 : 170)); // 90% easy
    const r = classifyRunIntensity({ timeS, distanceM, heartrate }, hrBands(PROFILE));
    expect(r.label).toBe("easy");
    expect(r.source).toBe("stream");
  });
});

describe("classifyFromAverage — fallback without a stream", () => {
  it("only commits at the extremes, and says it is an estimate", () => {
    expect(classifyFromAverage(142, PROFILE).label).toBe("easy");
    expect(classifyFromAverage(168, PROFILE).label).toBe("moderate");
    expect(classifyFromAverage(180, PROFILE).label).toBe("hard");
    expect(classifyFromAverage(142, PROFILE).source).toBe("average");
    expect(classifyFromAverage(null, PROFILE).label).toBe("unknown");
  });
});

describe("combinedEasyShare", () => {
  it("weights by time, so a long easy run outweighs a short hard one", () => {
    const easyLong = classifyFromTotals(totals(0, 45, 0, 0));
    const hardShort = classifyFromTotals(totals(0, 2, 13, 5));
    expect(combinedEasyShare([easyLong, hardShort])).toBeCloseTo(47 / 65, 3);
  });

  it("ignores average-only and unknown runs rather than guessing", () => {
    expect(combinedEasyShare([classifyFromAverage(142, PROFILE)])).toBeNull();
  });
});
