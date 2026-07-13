import { describe, expect, it } from "vitest";
import { parseRacesCsv, parseClock } from "./racesCsv.js";

const CSV = [
  `name,date,distance_km,official_time,terrain,elevation_gain_m,results_url,notes`,
  `# this is a comment and should be skipped`,
  `Maraton de Santiago 21K,2023-04-02,21.0975,1:48:30,road,120,https://x.com/r,PR`,
  `Trail Race,2022-11-13,12,1:14:05,trail,,,`,
].join("\n");

describe("parseRacesCsv", () => {
  const races = parseRacesCsv(CSV);

  it("skips comment lines and parses the real rows", () => {
    expect(races).toHaveLength(2);
  });

  it("converts km to meters and H:MM:SS to seconds", () => {
    expect(races[0]!.distanceM).toBeCloseTo(21097.5, 1);
    expect(races[0]!.officialTimeS).toBe(1 * 3600 + 48 * 60 + 30);
    expect(races[0]!.terrain).toBe("road");
    expect(races[0]!.elevationGainM).toBe(120);
    expect(races[0]!.resultsUrl).toBe("https://x.com/r");
  });

  it("treats blank optional fields as null", () => {
    expect(races[1]!.elevationGainM).toBeNull();
    expect(races[1]!.resultsUrl).toBeNull();
    expect(races[1]!.notes).toBeNull();
  });

  it("parses MM:SS as well as H:MM:SS", () => {
    expect(parseClock("45:30", 1)).toBe(45 * 60 + 30);
    expect(parseClock("1:02:03", 1)).toBe(3723);
  });

  it("rejects an unknown terrain, naming the line", () => {
    const bad = `name,date,distance_km,official_time,terrain\nX,2020-01-01,10,40:00,swamp`;
    expect(() => parseRacesCsv(bad)).toThrow(/line 2.*terrain/);
  });

  it("rejects a malformed time instead of dropping the race", () => {
    const bad = `name,date,distance_km,official_time,terrain\nX,2020-01-01,10,forty minutes,road`;
    expect(() => parseRacesCsv(bad)).toThrow(/official_time/);
  });

  it("rejects a malformed date", () => {
    const bad = `name,date,distance_km,official_time,terrain\nX,01/01/2020,10,40:00,road`;
    expect(() => parseRacesCsv(bad)).toThrow(/date must be YYYY-MM-DD/);
  });
});
