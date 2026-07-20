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
    fitness: {
      day: "2026-07-19",
      ctl: 0.6,
      atl: 0.1,
      tsb: 0.5,
      aerobicCtl: 3.2,
      aerobicAtl: 1.4,
      totalCtl: 3.7,
      totalAtl: 12.4,
      totalTsb: -8.7,
    },
    snapshot,
    latestActivityDate: new Date("2026-07-11T10:00:00Z"),
    races: [
      { name: "Media Maraton Medellin", raceDate: "2022-09-04", distanceKm: 21.0975, officialTimeS: 5979, terrain: "road" },
    ],
    plan: {
      weekStart: "2026-07-20",
      targetLimiter: "aerobic_base",
      keySession: { day: 6, title: "Long easy run", description: "Keep it conversational.", intensity: "low", planned_km: 0, planned_minutes: 30 },
      supportSessions: [
        { day: 0, title: "Strength", description: "Regular gym session.", intensity: "low", planned_km: 0, planned_minutes: 45 },
        { day: 1, title: "Easy run", description: "Relaxed return to running.", intensity: "low", planned_km: 0, planned_minutes: 20 },
        { day: 5, title: "Rest", description: "Full rest.", intensity: "rest", planned_km: 0 },
      ],
      explanation: "Return to running with short easy sessions.",
      generatedAt: new Date("2026-07-19T00:00:00Z"),
    },
    now: new Date("2026-07-18T12:00:00Z"),
    tz: "America/Bogota",
    ...overrides,
  };
}

describe("renderNow", () => {
  it("shows countdown, bracket target, and 2026 benchmarks", () => {
    const html = renderNow(nowData());
    expect(html).toContain("<strong>280</strong>");
    expect(html).toContain("days to race");
    expect(html).toContain("Varones 18-29");
    expect(html).toContain("1:37:14");
    expect(html).toContain("1:32:36"); // overall reference
  });

  it("renders an honest empty state when no prediction exists", () => {
    const html = renderNow(nowData());
    expect(html).toContain("Not enough recent running");
    expect(html).toContain("current-shape estimate will appear");
    expect(html).not.toContain("F1");
    expect(html).not.toContain("aerobic_base");
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
    expect(html).toContain("Body-weight history is not yet tracked");
  });

  it("calls out zero recent running instead of hiding it", () => {
    const html = renderNow(
      nowData({ snapshot: { ...snapshot, runs: 0, runKm: 0, runTimeS: 0, longestRunKm: null } }),
    );
    expect(html).toContain("rebuilding running consistency");
    expect(html).toContain("first easy run");
  });

  it("does not mistake recovery-labelled strength for a run or rest day", () => {
    const base = nowData().plan!;
    const html = renderNow(nowData({
      plan: {
        ...base,
        supportSessions: [
          { day: 0, title: "Lower-body strength", description: "Recovery-adjusted session; keep the following run easy.", intensity: "low", planned_km: 0 },
          { day: 1, title: "Easy run", description: "Conversational.", intensity: "low", planned_km: 0, planned_minutes: 20 },
          { day: 5, title: "Rest", description: "Full rest.", intensity: "rest", planned_km: 0 },
        ],
      },
    }));
    expect(html).toContain("Tuesday, Jul 21");
    expect(html).toContain("<span>Protected recovery</span><strong>Saturday</strong>");
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
  it("shows the run-specific CTL/ATL/TSB values", () => {
    const html = renderNow(nowData());
    expect(html).toContain("0.6");
    expect(html).toContain("Running chronic load");
    expect(html).toContain("0.1");
    expect(html).toContain("0.5");
    expect(html).toContain("Whole-program acute load");
    expect(html).toContain("not direct measurements of fitness");
  });
  it("points at the refresh button (not a CLI command) when fitness_state is empty", () => {
    const html = renderNow(nowData({ fitness: null }));
    expect(html).toContain("Update training");
    expect(html).not.toContain("npm run"); // the UI must not tell the user to use the CLI
  });
});

describe("renderWeek", () => {
  it("renders a generated plan as a friendly day-by-day schedule", () => {
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
    expect(html).toContain("Jul 20–26");
    expect(html).toContain("Key run");
    expect(html).toContain("Long run");
    expect(html).toContain("Rebuild running consistency");
    expect(html).not.toContain("aerobic_base");
    expect(html).toContain("Rebuild volume gently.");
  });

  it("does not count a strength description mentioning a run as running", () => {
    const html = renderWeek({
      tz: "America/Bogota",
      activities: [],
      plan: {
        weekStart: "2026-07-20",
        targetLimiter: "aerobic_base",
        keySession: { day: 6, title: "Long run", description: "Easy.", intensity: "low", planned_km: 0, planned_minutes: 30 },
        supportSessions: [
          { day: 0, title: "Lower-body strength", description: "Keep the following run easy.", intensity: "low", planned_km: 0 },
          { day: 2, title: "Easy run", description: "Easy.", intensity: "low", planned_km: 0, planned_minutes: 20 },
        ],
        explanation: "Return_to_run block.",
        generatedAt: new Date("2026-07-19T00:00:00Z"),
      },
    });
    expect(html).toContain("2 runs");
    expect(html).not.toContain("3 runs");
    expect(html).toContain("Return to running");
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
    expect(html).toContain("No plan is available yet");
    expect(html).toContain("Nothing logged yet in this plan week");
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
      tz: "America/Bogota",
    });
    expect(html).toContain("<svg");
    expect(html).toContain("Peak-era avg 45 km/wk");
    expect(html).toContain("No estimate history yet");
    expect(html).toContain("20.0 km avg");
  });

  it("lists live predictions once they exist", () => {
    const html = renderTrajectory({
      weeks: [],
      peakAvgKm: null,
      tz: "America/Bogota",
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
    expect(html).toContain("2026-07-31");
    expect(html).toContain("1:43:20");
  });
});
