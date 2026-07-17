import { describe, expect, it } from "vitest";
import { parseActivitiesCsv, parseExportDate } from "./activitiesCsv.js";

// Mirrors the real export's quirks: duplicate "Elapsed Time"/"Distance" headers,
// quoted names with commas, empty cells for gym activities.
const SAMPLE = [
  `Activity ID,Activity Date,Activity Name,Activity Type,Elapsed Time,Distance,Filename,Elapsed Time,Distance,Moving Time,Elevation Gain,Average Heart Rate,Max Heart Rate`,
  `1001,"Jul 7, 2018, 5:04:11 PM","Morning Run, easy",Run,2371,7.21,activities/1001.gpx,2371.0,7212.3,2290,85.2,152.3,171`,
  `1002,"Jan 2, 2024, 9:00:00 AM",Gym,Weight Training,3600,,, 3600.0,,3600,,,`,
].join("\n");

describe("parseActivitiesCsv", () => {
  const [run, gym] = parseActivitiesCsv(SAMPLE);

  it("parses a run row with duplicate headers, reading first-occurrence columns", () => {
    expect(run).toBeDefined();
    expect(run!.id).toBe(1001);
    expect(run!.name).toBe("Morning Run, easy");
    expect(run!.sportType).toBe("Run");
    expect(run!.elapsedTimeS).toBe(2371);
    expect(run!.distanceM).toBeCloseTo(7210, 0); // first Distance column is km
    expect(run!.movingTimeS).toBe(2290);
    expect(run!.elevationGainM).toBeCloseTo(85.2);
    expect(run!.avgHr).toBeCloseTo(152.3);
    expect(run!.maxHr).toBe(171);
    expect(run!.filename).toBe("activities/1001.gpx");
  });

  it("parses export dates as UTC", () => {
    expect(run!.startDate.toISOString()).toBe("2018-07-07T17:04:11.000Z");
  });

  it("handles gym rows with no distance, HR, or file", () => {
    expect(gym).toBeDefined();
    expect(gym!.sportType).toBe("Weight Training");
    expect(gym!.distanceM).toBeNull();
    expect(gym!.avgHr).toBeNull();
    expect(gym!.filename).toBeNull();
    expect(gym!.elapsedTimeS).toBe(3600);
  });

  it("keeps the full original row, with duplicate headers suffixed", () => {
    const raw = run!.raw as Record<string, string>;
    expect(raw["Distance"]).toBe("7.21");
    expect(raw["Distance_2"]).toBe("7212.3");
  });

  it("throws on unparseable dates instead of silently shifting history", () => {
    expect(() => parseExportDate("not a date")).toThrow(/unparseable/);
  });
});
