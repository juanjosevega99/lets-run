/**
 * Post-session check-in: types, the readiness-derivation policy, and the form parser.
 *
 * Policy stance (NEXT_STEPS.md P0): the software can measure completion and external
 * load, but only the athlete can report whether impact was tolerated. So —
 *   - missing feedback NEVER counts as readiness;
 *   - readiness requires every run of the reviewed week to be checked in, pain-free;
 *   - one significant-pain or unusual-soreness report anywhere in the week (runs OR
 *     gym) raises a red flag, which the review turns into a DELOAD.
 * Mild pain sits between: it blocks progression without forcing a deload.
 */

export const PAIN_LEVELS = ["not_reported", "none", "mild", "significant"] as const;
export type PainLevel = (typeof PAIN_LEVELS)[number];

export const SORENESS_LEVELS = ["not_reported", "none", "normal", "unusual"] as const;
export type SorenessLevel = (typeof SORENESS_LEVELS)[number];

export const GYM_FOCUS = ["upper", "lower", "full"] as const;
export type GymFocus = (typeof GYM_FOCUS)[number];

export const GYM_DIFFICULTY = ["easy", "moderate", "hard"] as const;
export type GymDifficulty = (typeof GYM_DIFFICULTY)[number];

export interface SessionFeedback {
  activityId: number;
  rpe: number | null;
  painDuring: PainLevel;
  morningSoreness: SorenessLevel;
  gymFocus: GymFocus | null;
  lowerBodyDifficulty: GymDifficulty | null;
  notes: string | null;
}

export interface ReadinessSignal {
  redFlag: boolean;
  readinessConfirmed: boolean;
  /** Human-readable audit trail, persisted into week_review.decision_inputs. */
  reasons: string[];
  runsCheckedIn: number;
  runsTotal: number;
}

/**
 * Derives the two controller inputs from a reviewed week's activities + check-ins.
 * `runActivityIds` are the week's runs; `weekFeedback` is every check-in from that
 * week (any sport — a painful gym session is still a stop signal).
 */
export function deriveReadiness(
  runActivityIds: number[],
  weekFeedback: SessionFeedback[],
): ReadinessSignal {
  const reasons: string[] = [];
  const byActivity = new Map(weekFeedback.map((f) => [f.activityId, f]));

  const painFlags = weekFeedback.filter((f) => f.painDuring === "significant");
  const sorenessFlags = weekFeedback.filter((f) => f.morningSoreness === "unusual");
  const redFlag = painFlags.length > 0 || sorenessFlags.length > 0;
  for (const f of painFlags) reasons.push(`significant pain reported on activity ${f.activityId}`);
  for (const f of sorenessFlags) reasons.push(`unusual next-morning soreness reported on activity ${f.activityId}`);

  const runFeedback = runActivityIds.map((id) => byActivity.get(id) ?? null);
  const missing = runFeedback.filter((f) => f == null).length;
  const unclearPain = runFeedback.filter(
    (f) => f != null && (f.painDuring === "not_reported" || f.painDuring === "mild"),
  );
  const unclearSoreness = runFeedback.filter((f) => f != null && f.morningSoreness === "not_reported");

  let readinessConfirmed = false;
  if (redFlag) {
    // reasons already recorded above
  } else if (runActivityIds.length === 0) {
    reasons.push("no runs to confirm readiness against");
  } else if (missing > 0) {
    reasons.push(`${missing} of ${runActivityIds.length} runs have no check-in — missing feedback is not a green signal`);
  } else if (unclearPain.length > 0) {
    reasons.push(
      unclearPain.some((f) => f!.painDuring === "mild")
        ? "mild pain reported — completion counts, progression does not"
        : "pain was not reported on every run",
    );
  } else if (unclearSoreness.length > 0) {
    reasons.push("next-morning soreness was not reported on every run");
  } else {
    readinessConfirmed = true;
    reasons.push(`all ${runActivityIds.length} runs checked in pain-free`);
  }

  return {
    redFlag,
    readinessConfirmed,
    reasons,
    runsCheckedIn: runActivityIds.length - missing,
    runsTotal: runActivityIds.length,
  };
}

/**
 * Validates the check-in form body (urlencoded fields) into a SessionFeedback.
 * Returns a string error rather than throwing — the endpoint turns it into a 400.
 */
export function parseFeedbackForm(fields: URLSearchParams): SessionFeedback | string {
  const activityId = Number(fields.get("activity_id"));
  if (!Number.isSafeInteger(activityId) || activityId <= 0) return "invalid activity_id";

  const rpeRaw = (fields.get("rpe") ?? "").trim();
  let rpe: number | null = null;
  if (rpeRaw !== "") {
    rpe = Number(rpeRaw);
    if (!Number.isInteger(rpe) || rpe < 1 || rpe > 10) return "rpe must be an integer from 1 to 10";
  }

  const painDuring = (fields.get("pain_during") ?? "not_reported") as PainLevel;
  if (!PAIN_LEVELS.includes(painDuring)) return "invalid pain_during";
  const morningSoreness = (fields.get("morning_soreness") ?? "not_reported") as SorenessLevel;
  if (!SORENESS_LEVELS.includes(morningSoreness)) return "invalid morning_soreness";

  const gymFocusRaw = fields.get("gym_focus");
  const gymFocus = gymFocusRaw ? (gymFocusRaw as GymFocus) : null;
  if (gymFocus != null && !GYM_FOCUS.includes(gymFocus)) return "invalid gym_focus";
  const difficultyRaw = fields.get("lower_body_difficulty");
  const lowerBodyDifficulty = difficultyRaw ? (difficultyRaw as GymDifficulty) : null;
  if (lowerBodyDifficulty != null && !GYM_DIFFICULTY.includes(lowerBodyDifficulty)) {
    return "invalid lower_body_difficulty";
  }

  const notesRaw = (fields.get("notes") ?? "").trim();
  if (notesRaw.length > 2000) return "notes too long";

  return {
    activityId,
    rpe,
    painDuring,
    morningSoreness,
    gymFocus,
    lowerBodyDifficulty,
    notes: notesRaw === "" ? null : notesRaw,
  };
}
