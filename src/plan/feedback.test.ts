import { describe, expect, it } from "vitest";
import { deriveReadiness, parseFeedbackForm, type SessionFeedback } from "./feedback.js";

function fb(activityId: number, over: Partial<SessionFeedback> = {}): SessionFeedback {
  return {
    activityId,
    rpe: 5,
    painDuring: "none",
    morningSoreness: "normal",
    gymFocus: null,
    lowerBodyDifficulty: null,
    notes: null,
    ...over,
  };
}

describe("deriveReadiness — missing feedback is never a green signal", () => {
  it("confirms readiness when every run is checked in pain-free", () => {
    const r = deriveReadiness([1, 2, 3], [fb(1), fb(2), fb(3)]);
    expect(r.readinessConfirmed).toBe(true);
    expect(r.redFlag).toBe(false);
    expect(r.runsCheckedIn).toBe(3);
    expect(r.runsTotal).toBe(3);
  });

  it("withholds readiness when one run has no check-in", () => {
    const r = deriveReadiness([1, 2, 3], [fb(1), fb(2)]);
    expect(r.readinessConfirmed).toBe(false);
    expect(r.redFlag).toBe(false);
    expect(r.runsCheckedIn).toBe(2);
    expect(r.reasons.join(" ")).toContain("no check-in");
  });

  it("treats mild pain as a hold, not a deload", () => {
    const r = deriveReadiness([1], [fb(1, { painDuring: "mild" })]);
    expect(r.readinessConfirmed).toBe(false);
    expect(r.redFlag).toBe(false);
  });

  it("raises a red flag for significant pain on a GYM session, despite pain-free runs", () => {
    const r = deriveReadiness([1], [fb(1), fb(99, { painDuring: "significant", gymFocus: "lower" })]);
    expect(r.redFlag).toBe(true);
    expect(r.readinessConfirmed).toBe(false);
  });

  it("raises a red flag for unusual next-morning soreness", () => {
    const r = deriveReadiness([1], [fb(1, { morningSoreness: "unusual" })]);
    expect(r.redFlag).toBe(true);
  });

  it("cannot confirm readiness from a week with no runs", () => {
    const r = deriveReadiness([], []);
    expect(r.readinessConfirmed).toBe(false);
    expect(r.reasons.join(" ")).toContain("no runs");
  });

  it("withholds readiness when soreness was left unreported", () => {
    const r = deriveReadiness([1], [fb(1, { morningSoreness: "not_reported" })]);
    expect(r.readinessConfirmed).toBe(false);
    expect(r.redFlag).toBe(false);
  });
});

describe("parseFeedbackForm", () => {
  const parse = (q: string) => parseFeedbackForm(new URLSearchParams(q));

  it("accepts a fully populated check-in", () => {
    const r = parse("activity_id=42&rpe=6&pain_during=none&morning_soreness=normal&gym_focus=lower&lower_body_difficulty=hard&notes=felt+good");
    expect(r).toMatchObject({
      activityId: 42,
      rpe: 6,
      painDuring: "none",
      morningSoreness: "normal",
      gymFocus: "lower",
      lowerBodyDifficulty: "hard",
      notes: "felt good",
    });
  });

  it("defaults everything but the id to not_reported", () => {
    expect(parse("activity_id=42")).toMatchObject({
      activityId: 42,
      rpe: null,
      painDuring: "not_reported",
      morningSoreness: "not_reported",
      gymFocus: null,
      notes: null,
    });
  });

  it("treats whitespace-only notes as absent", () => {
    expect(parse("activity_id=42&notes=%20%20")).toMatchObject({ notes: null });
  });

  for (const [label, query] of [
    ["a missing id", "rpe=5"],
    ["a non-numeric id", "activity_id=abc"],
    ["a zero id", "activity_id=0"],
    ["rpe below range", "activity_id=42&rpe=0"],
    ["rpe above range", "activity_id=42&rpe=11"],
    ["a fractional rpe", "activity_id=42&rpe=2.5"],
    ["an unknown pain level", "activity_id=42&pain_during=agony"],
    ["an unknown soreness level", "activity_id=42&morning_soreness=meh"],
    ["an unknown gym focus", "activity_id=42&gym_focus=cardio"],
    ["an unknown difficulty", "activity_id=42&lower_body_difficulty=brutal"],
  ] as const) {
    it(`rejects ${label}`, () => {
      expect(typeof parse(query)).toBe("string");
    });
  }

  it("rejects notes over the length cap", () => {
    expect(typeof parse(`activity_id=42&notes=${"x".repeat(2001)}`)).toBe("string");
  });
});
