import { describe, expect, it } from "vitest";
import { hrBands } from "./zones.js";
import {
  accumulateZoneTime,
  emptyZoneTotals,
  totalSeconds,
  zonePaceSecPerKm,
  zoneShare,
  MAX_SAMPLE_GAP_S,
} from "./zoneTime.js";

// hrMax 201 → easy floor 131, easy ceiling 159, threshold 177.
const bands = hrBands({ hrMax: 201, hrRest: 55 });

/** Build a stream at a constant pace with the given per-sample heart rates. */
function stream(hrs: number[], secPerSample = 5, metersPerSample = 12) {
  return {
    timeS: hrs.map((_, i) => i * secPerSample),
    distanceM: hrs.map((_, i) => i * metersPerSample),
    heartrate: hrs,
  };
}

describe("accumulateZoneTime", () => {
  it("splits time across the athlete's own bands", () => {
    // 4 intervals easy (140), 4 intervals moderate (165).
    const t = accumulateZoneTime(stream([140, 140, 140, 140, 140, 165, 165, 165, 165]), bands);
    expect(t.easy.seconds).toBe(20);
    expect(t.moderate.seconds).toBe(20);
    expect(t.recovery.seconds).toBe(0);
    expect(totalSeconds(t)).toBe(40);
    expect(zoneShare(t, "easy")).toBeCloseTo(0.5);
  });

  it("puts a run that averages 'easy' but drifts into the right two buckets", () => {
    // Mean of 130 and 170 is 150 — inside easy — but no sample was ever easy.
    const t = accumulateZoneTime(stream([130, 130, 130, 170, 170, 170]), bands);
    expect(t.easy.seconds).toBe(0);
    expect(t.recovery.seconds).toBeGreaterThan(0);
    expect(t.moderate.seconds).toBeGreaterThan(0);
  });

  it("respects the band edges (ceiling is exclusive)", () => {
    expect(accumulateZoneTime(stream([158, 158]), bands).easy.seconds).toBe(5);
    expect(accumulateZoneTime(stream([159, 159]), bands).moderate.seconds).toBe(5);
    expect(accumulateZoneTime(stream([177, 177]), bands).threshold.seconds).toBe(5);
  });

  it("ignores device pauses and bad samples instead of crediting them", () => {
    const gapped = {
      timeS: [0, 5, 5 + MAX_SAMPLE_GAP_S + 60, 5 + MAX_SAMPLE_GAP_S + 65],
      distanceM: [0, 12, 24, 36],
      heartrate: [140, 140, 140, 140],
    };
    // Only the two real 5s intervals count; the long pause is dropped.
    expect(totalSeconds(accumulateZoneTime(gapped, bands))).toBe(10);

    const noHr = { timeS: [0, 5], distanceM: [0, 12], heartrate: [140, 0] };
    expect(totalSeconds(accumulateZoneTime(noHr, bands))).toBe(0);
  });

  it("sums several runs into one total", () => {
    const acc = emptyZoneTotals();
    accumulateZoneTime(stream([140, 140, 140]), bands, acc);
    accumulateZoneTime(stream([140, 140, 140]), bands, acc);
    expect(acc.easy.seconds).toBe(20);
  });
});

describe("zonePaceSecPerKm", () => {
  it("reports the pace actually held inside a band", () => {
    // 12 m per 5 s = 2.4 m/s → 416.7 s/km.
    const t = accumulateZoneTime(stream(new Array(60).fill(140)), bands);
    expect(zonePaceSecPerKm(t, "easy")!).toBeCloseTo(416.7, 0);
  });

  it("withholds a pace when too little ground was covered in the band", () => {
    const t = accumulateZoneTime(stream([140, 140, 140]), bands); // ~24 m
    expect(zonePaceSecPerKm(t, "easy")).toBeNull();
    expect(zonePaceSecPerKm(t, "threshold")).toBeNull();
  });
});
