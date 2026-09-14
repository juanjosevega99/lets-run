import { describe, expect, it } from "vitest";
import { reviewWeek } from "./review.js";
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
