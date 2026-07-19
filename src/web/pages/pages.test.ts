import { describe, expect, it } from "vitest";
import { renderNow, type NowData } from "./now.js";
import { renderWeek } from "./week.js";
import { renderTrajectory } from "./trajectory.js";
import type { RecentSnapshot } from "../queries.js";

const snapshot: RecentSnapshot = {
  days: 28,
  runs: 5,
  runKm: 42.3,
  runTimeS: 13_500,
  longestRunKm: 12.4,
  bySport: [
    { sport: "Run", count: 5, km: 42.3 },
    { sport: "Weight Training", count: 3, km: 0 },
  ],
};

function nowData(overrides: Partial<NowData> = {}): NowData {
  return {
    daysToRace: 280,
    latestPrediction: null,
    fitness: { day: "2026-07-19", ctl: 0.6, atl: 8.0, tsb: -8.7 },
    snapshot,
    latestActivityDate: new Date("2026-07-11T10:00:00Z"),
    races: [
      { name: "Media Maraton Medellin", raceDate: "2022-09-04", distanceKm: 21.0975, officialTimeS: 5979, terrain: "road" },
    ],
    now: new Date("2026-07-18T12:00:00Z"),
    ...overrides,
  };
}

describe("renderNow", () => {
  it("shows countdown, bracket target, and 2026 benchmarks", () => {
    const html = renderNow(nowData());
    expect(html).toContain("280 days");
    expect(html).toContain("Varones 18-29");
    expect(html).toContain("1:37:14");
    expect(html).toContain("1:32:36"); // overall reference
  });

  it("renders an honest empty state when no prediction exists", () => {
    const html = renderNow(nowData());
    expect(html).toContain("No prediction yet");
    expect(html).toContain("F1");
  });

  it("shows the prediction with gap-to-target when one exists", () => {
    const html = renderNow(
      nowData({
        latestPrediction: {
          predictedAt: new Date("2026-07-18T00:00:00Z"),
          predictedTimeS: 6100, // 1:41:40 → 266s gap to 5834
          intervalP10S: 5900,
          intervalP90S: 6350,
          predictor: "riegel-v1",
        },
      }),
    );
    expect(html).toContain("1:41:40");
    expect(html).toContain("4:26"); // gap = 266s
    expect(html).toContain("to close");
    expect(html).toContain("riegel-v1");
    expect(html).toContain("1:38:20"); // P10
  });

  it("calls out zero recent running instead of hiding it", () => {
    const html = renderNow(
      nowData({ snapshot: { ...snapshot, runs: 0, runKm: 0, runTimeS: 0, longestRunKm: null } }),
    );
    expect(html).toContain("Zero runs in the last 28 days");
  });

  it("escapes HTML coming from the database", () => {
    const html = renderNow(
      nowData({
        races: [{ name: "<script>alert(1)</script>", raceDate: "2020-01-01", distanceKm: 10, officialTimeS: 3000, terrain: "road" }],
      }),
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderNow fitness", () => {
  it("shows CTL/ATL/TSB cards", () => {
    const html = renderNow(nowData());
    expect(html).toContain("0.6");
    expect(html).toContain("CTL — running fitness");
    expect(html).toContain("-8.7");
  });
  it("points at the refresh button (not a CLI command) when fitness_state is empty", () => {
    const html = renderNow(nowData({ fitness: null }));
    expect(html).toContain("Sync &amp; replan");
    expect(html).not.toContain("npm run"); // the UI must not tell the user to use the CLI
  });
});

describe("renderWeek", () => {
  it("renders a generated plan with the key session starred", () => {
    const html = renderWeek({
      tz: "America/Bogota",
      activities: [],
      plan: {
        weekStart: "2026-07-20",
        targetLimiter: "aerobic_base",
        keySession: { day: 6, title: "Long run", description: "easy", intensity: "low", planned_km: 8 },
        supportSessions: [
          { day: 0, title: "Easy run", description: "conversational", intensity: "low", planned_km: 5 },
        ],
        explanation: "Rebuild volume gently.",
        generatedAt: new Date("2026-07-19T00:00:00Z"),
      },
    });
    expect(html).toContain("week of 2026-07-20");
    expect(html).toContain("★ Long run");
    expect(html).toContain("aerobic_base");
    expect(html).toContain("Rebuild volume gently.");
  });

  it("renders logged activities with day names in the local timezone", () => {
    const html = renderWeek({
      tz: "America/Bogota",
      plan: null,
      activities: [
        {
          // 03:00 UTC Tuesday = 22:00 Monday in Bogota — must render as Mon
          startDate: new Date("2026-07-14T03:00:00Z"),
          name: "Night run",
          sportType: "Run",
          distanceM: 8000,
          movingTimeS: 2400,
        },
      ],
    });
    expect(html).toContain("Mon");
    expect(html).toContain("Night run");
    expect(html).toContain("8.0");
    expect(html).toContain("5:00/km");
  });

  it("shows empty states for both plan and empty log", () => {
    const html = renderWeek({ tz: "America/Bogota", activities: [], plan: null });
    expect(html).toContain("No plan yet");
    expect(html).toContain("Nothing logged yet this week");
  });
});

describe("renderTrajectory", () => {
  it("charts weekly volume with the peak-era reference line", () => {
    const html = renderTrajectory({
      weeks: [
        { weekStart: "2026-06-29", km: 20, runs: 3 },
        { weekStart: "2026-07-06", km: 25, runs: 4 },
      ],
      peakAvgKm: 45.2,
      predictions: [],
    });
    expect(html).toContain("<svg");
    expect(html).toContain("2021-22 avg 45 km/wk");
    expect(html).toContain("Empty until F1 + F2");
  });

  it("lists live predictions once they exist", () => {
    const html = renderTrajectory({
      weeks: [],
      peakAvgKm: null,
      predictions: [
        {
          predictedAt: new Date("2026-08-01T00:00:00Z"),
          predictedTimeS: 6200,
          intervalP10S: null,
          intervalP90S: null,
          predictor: "riegel-v1",
        },
      ],
    });
    expect(html).toContain("2026-08-01");
    expect(html).toContain("1:43:20");
  });
});
