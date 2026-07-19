import { describe, expect, it } from "vitest";
import { formatReport, type PredictorReport } from "./report.js";

describe("formatReport", () => {
  it("explains the empty registry instead of failing silently", () => {
    const out = formatReport([]);
    expect(out).toContain("no predictors registered");
    expect(out).toContain("src/deterministic/");
    expect(out).toContain("registry.ts");
  });

  it("renders per-race lines, MAE summary, and the S1 verdict", () => {
    const report: PredictorReport[] = [
      {
        predictor: "riegel-v1",
        evaluations: [
          {
            raceName: "Media Maraton Medellin",
            raceDate: "2022-09-04",
            distanceKm: 21.0975,
            actualS: 5979,
            predictedS: 6100,
            errorPct: 2.02,
            note: "ref: Cali 21K",
          },
          {
            raceName: "Race Rivera 10k",
            raceDate: "2021-08-15",
            distanceKm: 10,
            actualS: 3070,
            predictedS: 3010,
            errorPct: -1.95,
          },
        ],
      },
    ];
    const out = formatReport(report);
    expect(out).toContain("predictor: riegel-v1");
    expect(out).toContain("actual  1:39:39");
    expect(out).toContain("predicted  1:41:40");
    expect(out).toContain("+2.02%");
    expect(out).toContain("-1.95%");
    expect(out).toContain("(ref: Cali 21K)");
    expect(out).toMatch(/MAE 1\.9[89]%/); // (2.02+1.95)/2 = 1.985, float-rounds either way
    expect(out).toContain("PASS");
  });

  it("marks the S1 target as not met when MAE >= 3%", () => {
    const out = formatReport([
      {
        predictor: "bad-model",
        evaluations: [
          { raceName: "X", raceDate: "2022-01-01", distanceKm: 10, actualS: 3000, predictedS: 3300, errorPct: 10 },
        ],
      },
    ]);
    expect(out).toContain("not yet");
    expect(out).not.toContain("PASS");
  });

  it("shows failures per race without aborting the report", () => {
    const out = formatReport([
      {
        predictor: "gap-v1",
        evaluations: [
          {
            raceName: "X",
            raceDate: "2020-03-08",
            distanceKm: 5,
            actualS: 1676,
            predictedS: null,
            errorPct: null,
            failure: "no prior race to extrapolate from",
          },
        ],
      },
    ]);
    expect(out).toContain("FAILED: no prior race to extrapolate from");
    expect(out).toContain("no successful predictions");
  });
});
