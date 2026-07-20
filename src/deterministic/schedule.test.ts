import { describe, expect, it } from "vitest";
import { isAllEasyWeek, keyRunDay, lowerBodyConflictsWithKey } from "./schedule.js";

describe("isAllEasyWeek", () => {
  it("is easy for return-to-run and for base/long-endurance limiters", () => {
    expect(isAllEasyWeek("return_to_run", "threshold")).toBe(true); // phase wins
    expect(isAllEasyWeek("base", "aerobic_base")).toBe(true);
    expect(isAllEasyWeek("build", "long_endurance")).toBe(true);
  });
  it("is not easy for quality-limiter weeks", () => {
    expect(isAllEasyWeek("build", "threshold")).toBe(false);
    expect(isAllEasyWeek("race_specific", "race_specific")).toBe(false);
  });
});

describe("keyRunDay", () => {
  it("keys the last run day for all-easy weeks (the long run)", () => {
    expect(keyRunDay([0, 2, 4, 6], true)).toBe(6);
    expect(keyRunDay([1, 3, 6], true)).toBe(6);
  });
  it("keys the SECOND run day for one-high-day weeks (the quality session)", () => {
    expect(keyRunDay([0, 2, 4, 6], false)).toBe(2);
    expect(keyRunDay([1, 3, 5], false)).toBe(3);
  });
  it("falls back sensibly on short run-day lists", () => {
    expect(keyRunDay([2], false)).toBe(2);
    expect(keyRunDay([], true)).toBe(6);
  });
});

describe("lowerBodyConflictsWithKey", () => {
  it("flags the key day and the day immediately before it", () => {
    expect(lowerBodyConflictsWithKey(2, [2])).toBe(true);
    expect(lowerBodyConflictsWithKey(2, [1])).toBe(true);
    expect(lowerBodyConflictsWithKey(2, [0, 4])).toBe(false);
  });
  it("treats Sunday→Monday as adjacent (red-team M3 wraparound)", () => {
    // key Monday (0), lower-body Sunday (6): the old keyDay-1 guard missed this
    expect(lowerBodyConflictsWithKey(0, [6])).toBe(true);
    expect(lowerBodyConflictsWithKey(0, [0])).toBe(true);
    expect(lowerBodyConflictsWithKey(0, [5])).toBe(false);
  });
  it("accepts a Set as well as an array", () => {
    expect(lowerBodyConflictsWithKey(3, new Set([2]))).toBe(true);
  });
});
