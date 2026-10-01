import { describe, expect, it } from "vitest";
import { reviewWeek, summarizeActualIntensity } from "./review.js";
import type { RunIntensityResult } from "../deterministic/runIntensity.js";
import type { PlannedSession } from "../deterministic/validator.js";
import { deriveReadiness, type SessionFeedback } from "./feedback.js";

const key: PlannedSession = { day: 6, title: "Long run", intensity: "low", plannedKm: 4 };
const sessions: PlannedSession[] = [
  { day: 1, title: "Easy", intensity: "low", plannedKm: 3 },
  { day: 3, title: "Easy", intensity: "low", plannedKm: 3 },
  key,
];

describe("reviewWeek", () => {
  it("progresses a completed week", () => {
    const result = reviewWeek({
      sessions,
      keySession: key,
      actualRuns: [
        { day: 1, distanceKm: 3 },
        { day: 3, distanceKm: 3 },
        { day: 6, distanceKm: 4 },
      ],
      readinessConfirmed: true,
    });
    expect(result.decision).toBe("PROGRESS");
    expect(result.keyCompleted).toBe(true);
    expect(result.compliancePct).toBe(100);
  });

  it("repeats when the key session was missed even if filler was completed", () => {
    const result = reviewWeek({
      sessions,
      keySession: key,
      actualRuns: [
        { day: 1, distanceKm: 4 },
        { day: 3, distanceKm: 4 },
      ],
    });
    expect(result.decision).toBe("REPEAT");
    expect(result.keyCompleted).toBe(false);
  });

  it("proceeds when the key landed and only filler was missed", () => {
    const result = reviewWeek({
      sessions,
      keySession: key,
      actualRuns: [
        { day: 1, distanceKm: 2 },
        { day: 6, distanceKm: 4 },
      ],
    });
    expect(result.decision).toBe("PROCEED");
  });

  it("deloads on an explicit recovery red flag", () => {
    const result = reviewWeek({ sessions, keySession: key, actualRuns: [], redFlag: true });
    expect(result.decision).toBe("DELOAD");
  });

  it("counts a run moved by one day and never gives extra-volume credit above 100%", () => {
    const result = reviewWeek({
      sessions,
      keySession: key,
      actualRuns: [
        { day: 0, distanceKm: 5 }, // Tuesday easy moved to Monday
        { day: 3, distanceKm: 3 },
        { day: 5, distanceKm: 8 }, // Sunday key moved to Saturday, plus extra distance
      ],
      readinessConfirmed: true,
    });
    expect(result.keyCompleted).toBe(true);
    expect(result.completedRunSessions).toBe(3);
    expect(result.compliancePct).toBe(100);
    expect(result.decision).toBe("PROGRESS");
  });

  it("holds when objective compliance is green but pain/soreness feedback is missing", () => {
    const result = reviewWeek({
      sessions,
      keySession: key,
      actualRuns: [
        { day: 1, distanceKm: 3 },
        { day: 3, distanceKm: 3 },
        { day: 6, distanceKm: 4 },
      ],
    });
    expect(result.compliancePct).toBe(100);
    expect(result.decision).toBe("PROCEED");
    expect(result.explanation).toContain("readiness was not confirmed");
  });

  it("credits an all-easy key session to the week's longest run on any day", () => {
    // Real case: 61 logged minutes against 45 planned, including a run 2.7x the planned
    // key — scored REPEAT only because it landed on Monday instead of Sunday.
    const easyKey: PlannedSession = {
      day: 6,
      title: "Longest easy run/walk",
      intensity: "low",
      plannedKm: 1.6,
      plannedMinutes: 15,
    };
    const easyWeek: PlannedSession[] = [
      { day: 1, title: "Easy", intensity: "low", plannedKm: 1.1, plannedMinutes: 15 },
      { day: 3, title: "Easy", intensity: "low", plannedKm: 1.3, plannedMinutes: 15 },
      easyKey,
    ];
    const result = reviewWeek({
      sessions: easyWeek,
      keySession: easyKey,
      actualRuns: [
        { day: 0, distanceKm: 5.61, durationMinutes: 40 },
        { day: 2, distanceKm: 3.27, durationMinutes: 21 },
      ],
      keyMatchesAnyDay: true,
    });
    expect(result.keyCompleted).toBe(true);
    expect(result.decision).toBe("PROCEED");
  });

  it("spends the any-day key on the biggest run, not the first one it finds", () => {
    const anyDayKey: PlannedSession = { day: 6, title: "Long run", intensity: "low", plannedKm: 4 };
    const result = reviewWeek({
      sessions: [{ day: 1, title: "Easy", intensity: "low", plannedKm: 3 }, anyDayKey],
      keySession: anyDayKey,
      actualRuns: [
        { day: 1, distanceKm: 4.2 },
        { day: 4, distanceKm: 9 },
      ],
      keyMatchesAnyDay: true,
    });
    expect(result.keyCompleted).toBe(true);
    expect(result.completedRunSessions).toBe(2); // the 4.2km still covers the easy day
  });

  it("counts every run of an all-easy week, whatever day each landed on", () => {
    // Juan's week of 2026-09-07: planned Tue/Thu/Sun, run Mon/Wed/Sun. All three were
    // done; date-matching the support runs scored it 2 of 3.
    const k: PlannedSession = { day: 6, title: "Long run", intensity: "low", plannedKm: 4.6 };
    const week: PlannedSession[] = [
      { day: 1, title: "Easy run", intensity: "low", plannedKm: 3.4 },
      { day: 3, title: "Easy run", intensity: "low", plannedKm: 3.4 },
      k,
    ];
    const result = reviewWeek({
      sessions: week,
      keySession: k,
      actualRuns: [
        { day: 0, distanceKm: 4.13 },
        { day: 2, distanceKm: 4.56 },
        { day: 6, distanceKm: 5.8 },
      ],
      keyMatchesAnyDay: true,
    });
    expect(result.keyCompleted).toBe(true);
    expect(result.completedRunSessions).toBe(3);
    expect(result.compliancePct).toBe(100);
  });

  it("keeps the strict window for a week with real intensity structure", () => {
    const hardKey: PlannedSession = { day: 6, title: "Threshold", intensity: "high", plannedKm: 8 };
    const structured: PlannedSession[] = [
      { day: 1, title: "Easy", intensity: "low", plannedKm: 6 },
      hardKey,
    ];
    const result = reviewWeek({
      sessions: structured,
      keySession: hardKey,
      actualRuns: [{ day: 2, distanceKm: 9 }],
    });
    expect(result.keyCompleted).toBe(false);
    expect(result.decision).toBe("REPEAT");
  });

  it("reviews duration-first run/walk sessions by time, not estimated distance", () => {
    const durationKey: PlannedSession = {
      day: 6,
      title: "Run/walk",
      intensity: "low",
      plannedKm: 4,
      plannedMinutes: 30,
    };
    const result = reviewWeek({
      sessions: [durationKey],
      keySession: durationKey,
      actualRuns: [{ day: 6, distanceKm: 1.5, durationMinutes: 30 }],
      readinessConfirmed: true,
    });
    expect(result.keyCompleted).toBe(true);
    expect(result.compliancePct).toBe(100);
    expect(result.decision).toBe("PROGRESS");
  });
});

/**
 * The loop that was dead in production until the check-in shipped: readiness derived
 * from real check-ins, fed into the same review that drives next week's progression.
 * Without this composition, PROGRESS and DELOAD were both unreachable no matter what
 * the athlete did.
 */
describe("readiness → review, composed", () => {
  const checkin = (activityId: number, over: Partial<SessionFeedback> = {}): SessionFeedback => ({
    activityId,
    rpe: 5,
    painDuring: "none",
    morningSoreness: "normal",
    gymFocus: null,
    lowerBodyDifficulty: null,
    notes: null,
    ...over,
  });
  const doneWeek = [
    { day: 1, distanceKm: 3 },
    { day: 3, distanceKm: 3 },
    { day: 6, distanceKm: 4 },
  ];
  const review = (feedback: SessionFeedback[], runIds: number[]) => {
    const readiness = deriveReadiness(runIds, feedback);
    return reviewWeek({
      sessions,
      keySession: key,
      actualRuns: doneWeek,
      redFlag: readiness.redFlag,
      readinessConfirmed: readiness.readinessConfirmed,
    });
  };

  it("reaches PROGRESS when every run is checked in pain-free", () => {
    expect(review([checkin(1), checkin(2), checkin(3)], [1, 2, 3]).decision).toBe("PROGRESS");
  });

  it("holds at PROCEED when a run was completed but never checked in", () => {
    expect(review([checkin(1), checkin(2)], [1, 2, 3]).decision).toBe("PROCEED");
  });

  it("deloads a fully completed week when significant pain was reported", () => {
    const result = review([checkin(1), checkin(2), checkin(3, { painDuring: "significant" })], [1, 2, 3]);
    expect(result.decision).toBe("DELOAD");
    expect(result.compliancePct).toBe(100); // completion never overrides a pain report
  });

  it("deloads on a painful GYM session even when the running week was clean", () => {
    const feedback = [checkin(1), checkin(2), checkin(3), checkin(90, { morningSoreness: "unusual" })];
    expect(review(feedback, [1, 2, 3]).decision).toBe("DELOAD");
  });
});

describe("summarizeActualIntensity — what the week actually was", () => {
  const easyWeek: PlannedSession[] = [
    { day: 0, title: "Easy", intensity: "low", plannedKm: 3 },
    { day: 2, title: "Easy", intensity: "low", plannedKm: 3 },
    { day: 6, title: "Long", intensity: "low", plannedKm: 6 },
  ];
  const run = (label: "easy" | "moderate" | "hard", easyShare: number, minutes: number): RunIntensityResult => ({
    label,
    easyShare,
    hardShare: label === "hard" ? 0.15 : 0,
    measuredSeconds: minutes * 60,
    source: "stream",
  });

  it("flags a run that went hard against an all-easy prescription", () => {
    // Juan, week of 2026-09-28: Mon easy 45 min, Thu 40-min tempo with a friend.
    const s = summarizeActualIntensity(easyWeek, [run("easy", 1, 45), run("hard", 0.15, 40)]);
    expect(s.harderThanPlanned).toBe(1);
    expect(s.note).toContain("all-easy prescription");
  });

  it("flags a week whose actual running fell under the polarization floor", () => {
    const s = summarizeActualIntensity(easyWeek, [run("easy", 1, 45), run("hard", 0.15, 40)]);
    // (45 + 6) / 85 = 60% easy, under 75%
    expect(s.actualEasyShare).toBeCloseTo(51 / 85, 2);
    expect(s.note).toContain("was easy");
  });

  it("does not flag hard runs the plan asked for", () => {
    const quality: PlannedSession[] = [...easyWeek, { day: 3, title: "Threshold", intensity: "high", plannedKm: 6 }];
    expect(summarizeActualIntensity(quality, [run("easy", 1, 45), run("hard", 0.2, 30)]).harderThanPlanned).toBe(0);
  });

  it("says nothing about a week run as prescribed", () => {
    expect(summarizeActualIntensity(easyWeek, [run("easy", 0.95, 30), run("easy", 1, 45)]).note).toBeNull();
  });

  it("is advisory: it never changes the decision reviewWeek makes", () => {
    const base = { sessions: easyWeek, keySession: easyWeek[2]!, keyMatchesAnyDay: true };
    const actualRuns = [
      { day: 0, distanceKm: 3 },
      { day: 2, distanceKm: 3 },
      { day: 6, distanceKm: 6 },
    ];
    // reviewWeek has no intensity input at all — that separation is the guarantee.
    expect(reviewWeek({ ...base, actualRuns }).decision).toBe("PROCEED");
  });
});

