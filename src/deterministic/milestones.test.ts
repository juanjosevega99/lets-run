import { describe, expect, it } from "vitest";
import { consistencyStreak, estimateUnlock, longRunMilestone, STREAK_TARGET_WEEKS } from "./milestones.js";

describe("longRunMilestone", () => {
  // Juan's real ladder: 7.39km on 2025-10-22, then nothing longer until Oct 2026.
  const history = [
    { date: "2025-10-12", km: 10.25 },
    { date: "2025-10-22", km: 7.39 },
    { date: "2026-09-13", km: 5.8 },
    { date: "2026-09-28", km: 6.11 },
    { date: "2026-10-01", km: 6.78 },
  ];

  it("reports the longest recent run against the last run that went further", () => {
    expect(longRunMilestone(history, "2026-10-02")).toEqual({
      km: 6.78,
      date: "2026-10-01",
      longestSince: "2025-10-22",
    });
  });

  it("says nothing once the run is no longer recent", () => {
    expect(longRunMilestone(history, "2026-10-30")).toBeNull();
  });

  it("is not a milestone if something longer happened within the last month", () => {
    // 8km three weeks before — outside the 14-day news window, inside the 30-day bar.
    const h = [{ date: "2026-09-10", km: 8 }, { date: "2026-10-01", km: 6.78 }];
    expect(longRunMilestone(h, "2026-10-02")).toBeNull();
  });

  it("reports the longer run itself when IT is the recent one", () => {
    const h = [{ date: "2026-09-20", km: 8 }, { date: "2026-10-01", km: 6.78 }];
    expect(longRunMilestone(h, "2026-10-02")?.km).toBe(8);
  });

  it("calls it the longest on record when nothing ever went further", () => {
    expect(longRunMilestone([{ date: "2026-10-01", km: 6.78 }], "2026-10-02")?.longestSince).toBeNull();
  });
});

describe("consistencyStreak", () => {
  const w = (runs: number[]) => runs.map((r, i) => ({ weekStart: `w${i}`, runs: r }));

  it("counts completed 3-run weeks back from the most recent", () => {
    expect(consistencyStreak(w([1, 3, 3, 4, 0])).current).toBe(3);
  });

  it("does not let an unfinished week break the streak", () => {
    // Wednesday, one run in so far this week.
    expect(consistencyStreak(w([3, 3, 1])).current).toBe(2);
  });

  it("counts this week as soon as it qualifies", () => {
    const s = consistencyStreak(w([3, 3, 3]));
    expect(s.current).toBe(3);
    expect(s.includesThisWeek).toBe(true);
  });

  it("resets on a short completed week — Juan, autumn 2026", () => {
    const s = consistencyStreak(w([2, 3, 1, 1, 2]));
    expect(s.current).toBe(0);
    expect(s.best).toBe(1);
  });

  it("measures against the re-anchored 12-week goal", () => {
    expect(consistencyStreak(w([3])).target).toBe(STREAK_TARGET_WEEKS);
  });
});

describe("estimateUnlock", () => {
  it("knows exactly how much distance the estimate is waiting on", () => {
    const u = estimateUnlock(6.78, 21.0975, 3);
    expect(u.unlocked).toBe(false);
    expect(u.neededKm).toBeCloseTo(7.0325, 3);
    expect(u.remainingKm).toBeCloseTo(0.2525, 3);
  });

  it("unlocks at the boundary", () => {
    expect(estimateUnlock(7.04, 21.0975, 3).unlocked).toBe(true);
  });
});
