import { describe, expect, it } from "vitest";
import { mapSummaryActivity, mapStreams, type StravaSummaryActivity } from "./api.js";

describe("mapSummaryActivity", () => {
  it("maps a full summary activity", () => {
    const a: StravaSummaryActivity = {
      id: 123,
      name: "Morning run",
      type: "Run",
      sport_type: "Run",
      start_date: "2024-03-10T12:00:00Z",
      elapsed_time: 1800,
      moving_time: 1750,
      distance: 5000,
      total_elevation_gain: 40,
      average_heartrate: 150,
      max_heartrate: 172,
    };
    const meta = mapSummaryActivity(a);
    expect(meta.id).toBe(123);
    expect(meta.sportType).toBe("Run");
    expect(meta.startDate.toISOString()).toBe("2024-03-10T12:00:00.000Z");
    expect(meta.distanceM).toBe(5000);
    expect(meta.avgHr).toBe(150);
    expect(meta.filename).toBeNull();
    expect(meta.raw).toBe(a);
  });

  it("falls back to type when sport_type is absent, and nulls missing HR", () => {
    const a: StravaSummaryActivity = {
      id: 456,
      name: "Old activity",
      type: "Ride",
      start_date: "2020-01-01T00:00:00Z",
    };
    const meta = mapSummaryActivity(a);
    expect(meta.sportType).toBe("Ride");
    expect(meta.avgHr).toBeNull();
    expect(meta.distanceM).toBeNull();
  });
});

describe("mapStreams", () => {
  it("aligns present channels to the time series", () => {
    const s = mapStreams({
      time: { data: [0, 10, 20] },
      distance: { data: [0, 50, 110] },
      heartrate: { data: [120, 130, 135] },
    });
    expect(s.timeS).toEqual([0, 10, 20]);
    expect(s.distanceM).toEqual([0, 50, 110]);
    expect(s.heartrate).toEqual([120, 130, 135]);
    expect(s.altitudeM).toEqual([null, null, null]);
  });

  it("returns empty arrays when there is no time stream", () => {
    const s = mapStreams({});
    expect(s.timeS).toEqual([]);
    expect(s.distanceM).toEqual([]);
  });
});
