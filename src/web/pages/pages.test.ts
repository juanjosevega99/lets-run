import { describe, expect, it } from "vitest";
import { pendingRunCheckins, renderCheckinPrompt } from "./checkin.js";
import type { CheckinActivity } from "../queries.js";
import { raceTrajectory } from "../../deterministic/trajectory.js";
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
    checkin: [],
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
          reliable: true,
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

  it("pauses the estimate instead of showing an over-optimistic time when it has no anchor", () => {
    const html = renderNow(
      nowData({
        snapshot: { ...snapshot, runs: 0, runKm: 0, runTimeS: 0, longestRunKm: null },
        latestPrediction: {
          predictedAt: new Date("2026-07-18T00:00:00Z"),
          predictedTimeS: 6517, // the real over-optimistic 1:48:37
          intervalP10S: null,
          intervalP90S: null,
          predictor: "vdot-ctl-v1",
          reliable: false,
        },
      }),
    );
    expect(html).not.toContain("1:48:37"); // the misleading number must never render
    expect(html).toContain("Not enough recent running");
    expect(html).toContain("Estimate paused");
    expect(html).toContain("resumes once you have a running base");
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
      checkin: [],
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
      checkin: [],
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

  it("renders a check-in form for an activity with no feedback yet", () => {
    const html = renderWeek({
      tz: "America/Bogota",
      plan: null,
      activities: [],
      checkin: [
        {
          id: 771,
          startDate: new Date("2026-09-07T14:00:00Z"),
          name: "Afternoon Run",
          sportType: "Run",
          distanceM: 4130,
          movingTimeS: 1860,
          feedback: null,
        },
      ],
    });
    expect(html).toContain('action="/actions/checkin"');
    expect(html).toContain('name="activity_id" value="771"');
    expect(html).toContain('name="pain_during"');
    expect(html).toContain('name="morning_soreness"');
    expect(html).toContain("Save check-in");
    expect(html).toContain("Needs check-in");
    expect(html).not.toContain('name="gym_focus"');
    expect(html).not.toContain("not_reported<");
  });

  it("adds gym fields for a strength session and prefills existing feedback", () => {
    const html = renderWeek({
      tz: "America/Bogota",
      plan: null,
      activities: [],
      checkin: [
        {
          id: 902,
          startDate: new Date("2026-09-07T12:00:00Z"),
          name: "Morning Weight Training",
          sportType: "WeightTraining",
          distanceM: 0,
          movingTimeS: 4800,
          feedback: {
            activityId: 902,
            rpe: 7,
            painDuring: "none",
            morningSoreness: "normal",
            gymFocus: "lower",
            lowerBodyDifficulty: "hard",
            notes: null,
          },
        },
      ],
    });
    expect(html).toContain('name="gym_focus"');
    expect(html).toContain('name="lower_body_difficulty"');
    expect(html).toContain("Update check-in");
    expect(html).toContain("RPE 7 · No pain · Normal post-training");
    expect(html).toContain('<option value="lower" selected>Lower</option>');
    expect(html).toContain('<option value="7" selected>7</option>');
  });

  it("renders logged activities with day names in the local timezone", () => {
    const html = renderWeek({
      tz: "America/Bogota",
      plan: null,
      checkin: [],
      activities: [
        {
          id: 1,
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
    const html = renderWeek({ checkin: [], tz: "America/Bogota", activities: [], plan: null });
    expect(html).toContain("No plan is available yet");
    expect(html).toContain("Nothing logged yet in this plan week");
  });
});

describe("renderTrajectory", () => {
  it("charts weekly volume with the peak-era reference line", () => {
    const html = renderTrajectory({
      trajectory: null,
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
      trajectory: null,
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
          reliable: true,
        },
      ],
    });
    expect(html).toContain("2026-07-31");
    expect(html).toContain("1:43:20");
  });

  it("shows paused rather than an over-optimistic time for an unanchored estimate", () => {
    const html = renderTrajectory({
      trajectory: null,
      weeks: [],
      peakAvgKm: null,
      tz: "America/Bogota",
      predictions: [
        {
          predictedAt: new Date("2026-08-01T00:00:00Z"),
          predictedTimeS: 6517,
          intervalP10S: null,
          intervalP90S: null,
          predictor: "vdot-ctl-v1",
          reliable: false,
        },
      ],
    });
    expect(html).not.toContain("1:48:37");
    expect(html).toContain("Paused (no anchor)");
  });
});

describe("renderTrajectory — required trajectory panel", () => {
  const base = { weeks: [], peakAvgKm: null, predictions: [], tz: "America/Bogota" };

  it("omits the panel entirely when no forward model is available", () => {
    const html = renderTrajectory({ ...base, trajectory: null });
    expect(html).not.toContain("Required trajectory");
  });

  it("shows the required rate and the weeks still available to miss", () => {
    const html = renderTrajectory({
      ...base,
      trajectory: raceTrajectory({
        raceKm: 21.0975,
        weeksToRace: 33,
        currentWeeklyKm: 9.1,
        currentLongestRunKm: 5.61,
      }),
    });
    expect(html).toContain("Required trajectory");
    expect(html).toContain("Weeks you can still miss");
    expect(html).toContain("Tight");
    expect(html).toMatch(/Weekly volume · \+\d+\.\d%\/wk/);
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
    expect(html).not.toContain("at_risk");
  });

  it("says the goal has to move rather than prescribing an unsafe rate", () => {
    const html = renderTrajectory({
      ...base,
      trajectory: raceTrajectory({
        raceKm: 21.0975,
        weeksToRace: 12,
        currentWeeklyKm: 9,
        currentLongestRunKm: 5,
      }),
    });
    expect(html).toContain("Out of reach");
    expect(html).toContain("has to move");
  });
});

describe("renderCheckinPrompt", () => {
  const run = (id: number): CheckinActivity => ({
    id,
    startDate: new Date("2026-09-13T14:00:00Z"),
    name: "Afternoon Run",
    sportType: "Run",
    distanceM: 5800,
    movingTimeS: 2700,
    feedback: null,
  });

  it("renders nothing when every run is already checked in", () => {
    expect(renderCheckinPrompt(pendingRunCheckins([]), "/")).toBe("");
    const done = { ...run(1), feedback: { activityId: 1, rpe: 5, painDuring: "none", morningSoreness: "normal", gymFocus: null, lowerBodyDifficulty: null, notes: null } } as CheckinActivity;
    expect(renderCheckinPrompt(pendingRunCheckins([done]), "/")).toBe("");
  });

  it("batches every pending run into one submission", () => {
    const html = renderCheckinPrompt(pendingRunCheckins([run(1), run(2), run(3)]), "/");
    expect(html).toContain('name="activity_ids" value="1,2,3"');
    expect(html).toContain('value="none"');
    expect(html).toContain('value="normal"');
    expect(html).toContain("No pain on any of those 3 runs");
    expect(html).toContain('name="return_to" value="/"');
  });

  it("states a positive fact rather than offering a skip", () => {
    const html = renderCheckinPrompt(pendingRunCheckins([run(1)]), "/week");
    expect(html).toContain("No pain on that run");
    expect(html.toLowerCase()).not.toContain("skip");
    expect(html.toLowerCase()).not.toContain("dismiss");
  });

  it("ignores strength sessions — only runs gate readiness", () => {
    const gym: CheckinActivity = { ...run(9), sportType: "WeightTraining", distanceM: 0 };
    expect(pendingRunCheckins([gym])).toHaveLength(0);
  });
});

