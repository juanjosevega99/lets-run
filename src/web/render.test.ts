import { describe, expect, it } from "vitest";
import { renderDashboard, type RaceDisplay } from "./render.js";
import type { Profile } from "../profile/buildProfile.js";

const profile: Profile = {
  totalActivities: 1818,
  dateRange: { from: new Date("2018-04-30T00:00:00Z"), to: new Date("2026-07-11T00:00:00Z") },
  byType: [
    { type: "Run", count: 943 },
    { type: "Ride", count: 577 },
  ],
  withStreams: 1700,
  withHr: 1200,
  withAltitude: 1600,
  withDistanceStream: 1700,
  races: { total: 2, matched: 1, unmatched: 1 },
};

describe("renderDashboard", () => {
  it("renders headline counts, coverage, and type breakdown", () => {
    const html = renderDashboard(profile, []);
    expect(html).toContain("<title>lets-run</title>");
    expect(html).toContain("1818");
    expect(html).toContain("2018-04-30 → 2026-07-11");
    expect(html).toContain("Run");
    expect(html).toContain("943");
    // coverage percentage: 1200/1818 ≈ 66%
    expect(html).toContain("66%");
  });

  it("prompts for T0 when there are no races", () => {
    const html = renderDashboard(profile, []);
    expect(html).toContain("No races imported yet");
    expect(html).toContain("races.csv");
  });

  it("renders a races table with formatted times when present", () => {
    const races: RaceDisplay[] = [
      { name: "Media Maraton Medellin", raceDate: "2022-09-04", distanceKm: 21.0975, officialTimeS: 5979, terrain: "road" },
    ];
    const html = renderDashboard(profile, races);
    expect(html).toContain("Media Maraton Medellin");
    expect(html).toContain("1:39:39"); // 5979s
    expect(html).toContain("21.1");
  });

  it("escapes HTML in race names to avoid broken markup", () => {
    const races: RaceDisplay[] = [
      { name: "Trail <script> & pain", raceDate: "2021-01-01", distanceKm: 10, officialTimeS: 3000, terrain: "trail" },
    ];
    const html = renderDashboard(profile, races);
    expect(html).toContain("Trail &lt;script&gt; &amp; pain");
    expect(html).not.toContain("<script> & pain");
  });
});
