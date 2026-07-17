import { describe, expect, it } from "vitest";
import { buildProfile, formatProfile, type ActivityFacts, type RaceFacts } from "./buildProfile.js";

function activity(overrides: Partial<ActivityFacts> & { id: number }): ActivityFacts {
  return {
    sportType: "Run",
    startDate: new Date("2024-01-01T00:00:00Z"),
    hasStreams: true,
    hasHr: true,
    hasAltitude: true,
    hasDistanceStream: true,
    ...overrides,
  };
}

describe("buildProfile", () => {
  const activities: ActivityFacts[] = [
    activity({ id: 1, sportType: "Run", startDate: new Date("2020-05-01T00:00:00Z") }),
    activity({ id: 2, sportType: "Run", startDate: new Date("2024-06-15T00:00:00Z"), hasHr: false }),
    activity({
      id: 3,
      sportType: "Weight Training",
      startDate: new Date("2022-03-10T00:00:00Z"),
      hasStreams: false,
      hasHr: false,
      hasAltitude: false,
      hasDistanceStream: false,
    }),
    activity({ id: 4, sportType: "Ride", startDate: new Date("2021-08-20T00:00:00Z") }),
  ];
  const races: RaceFacts[] = [
    { id: 1, activityId: 1 },
    { id: 2, activityId: null },
  ];
  const p = buildProfile(activities, races);

  it("counts activities and coverage", () => {
    expect(p.totalActivities).toBe(4);
    expect(p.withStreams).toBe(3);
    expect(p.withHr).toBe(2); // ids 1 and 4; id 2 has no HR, id 3 no streams
    expect(p.withAltitude).toBe(3);
    expect(p.withDistanceStream).toBe(3);
  });

  it("reports the full date span", () => {
    expect(p.dateRange?.from.toISOString()).toBe("2020-05-01T00:00:00.000Z");
    expect(p.dateRange?.to.toISOString()).toBe("2024-06-15T00:00:00.000Z");
  });

  it("histograms types, most frequent first", () => {
    expect(p.byType).toEqual([
      { type: "Run", count: 2 },
      { type: "Ride", count: 1 },
      { type: "Weight Training", count: 1 },
    ]);
  });

  it("tallies matched vs unmatched races", () => {
    expect(p.races).toEqual({ total: 2, matched: 1, unmatched: 1 });
  });

  it("handles an empty dataset without dividing by zero", () => {
    const empty = buildProfile([], []);
    expect(empty.dateRange).toBeNull();
    expect(formatProfile(empty)).toContain("no activities");
  });

  it("renders coverage percentages relative to total", () => {
    const out = formatProfile(p);
    expect(out).toContain("with heart rate: 2   (50% of all)");
    expect(out).toContain("activities:        4");
  });
});
