/**
 * Deterministic week template — the free, no-LLM alternative to F3's plan/generate.ts.
 * Same inputs (limiter, fitness, paces), same output shape, same S2 validator — the
 * only difference is *how* the week is filled in: fixed percentage splits instead of
 * an LLM's judgment. No API call, ever. This is the F-A stand-in taken one step
 * further than limiter.ts: not just "what's the limiter" but "what does a week that
 * respects it actually look like."
 *
 * Deliberately conservative: phase-appropriate running frequency, at least one full
 * rest day, and at most one high-intensity session.
 */

import type { Limiter } from "./limiter.js";
import type { TrainingPhase } from "./trainingPhase.js";
import { keyRunDay } from "./schedule.js";
import { MAX_WEEKLY_PROGRESSION } from "./validator.js";
import type { WeekDecision } from "../plan/review.js";

export interface TemplateSession {
  day: number; // 0 = Monday … 6 = Sunday
  title: string;
  description: string;
  intensity: "low" | "high" | "rest";
  planned_km: number;
  /** Primary dose for return-to-run sessions; distance remains an estimate. */
  planned_minutes?: number;
}

export interface WeekTemplate {
  target_limiter: Limiter;
  key_session: TemplateSession;
  support_sessions: TemplateSession[];
  explanation: string;
}

export interface WeekTemplateInput {
  limiter: Limiter;
  limiterReason: string;
  trainingPhase: TrainingPhase;
  previousWeekKm: number | null;
  /** Completed weekly running volume, oldest first — lets the controller recover ground. */
  recentWeeklyKm?: number[];
  /**
   * Where the race trajectory says this week should land (`trajectory.thisWeekTargetKm`).
   * Shapes growth that readiness has ALREADY earned; it can never create growth on its
   * own — see plannedRunVolumeCeiling.
   */
  trajectoryTargetKm?: number | null;
  tsb: number;
  /** Run + aerobic cross-training balance; may guard running after unusually heavy aerobic work. */
  aerobicTsb?: number | null;
  totalAtl?: number | null;
  /** Whole-program context only. Generic gym duration is not a readiness measurement. */
  totalTsb?: number | null;
  previousDecision: WeekDecision | null;
  runDays: number[];
  strengthDays: number[];
  lowerBodyStrengthDays: number[];
  longestRunKm30d: number;
  easyPaceSecPerKm: number | null;
  thresholdPaceSecPerKm: number | null;
  /**
   * Do-not-exceed HR for easy running. When present it is quoted as the PRIMARY
   * control and pace is demoted to a guide — heart rate is self-normalizing to
   * current fitness, a pace number isn't.
   */
  easyHrCeiling?: number | null;
}

const DEFAULT_RETURN_KM = 10;
const DEFAULT_STARTING_KM = 12;
const HIGH_SESSION_SHARE = 0.18; // well under the validator's 25% high-intensity ceiling
const LONG_RUN_SHARE_BASE = 0.3; // aerobic_base / long_endurance key session
/**
 * The long run has to actually BE the longest run of the week. A flat 30% share fails
 * that whenever the week has three run days, where an even split is already 33% — the
 * "key session" came out SHORTER than each easy run (2.6km key beside two 3.1km easy
 * runs). Scaling the floor with run frequency keeps the long run ~20% longer than an
 * easy day at any run-day count.
 */
const LONG_RUN_MIN_RATIO_TO_EVEN = 1.2;
const LONG_RUN_SHARE_SUPPORT = 0.28; // long run as a support session (threshold/race_specific weeks)
export const RUNNING_LOAD_GUARDRAIL = -20;

export function buildWeekTemplate(x: WeekTemplateInput): WeekTemplate {
  // Progression is earned by completed training, not granted automatically. Running
  // TSB is a guardrail only; total multi-sport acute load is reported separately.
  const progression = runningProgressionFactor(x);
  const totalKm = plannedRunVolumeCeiling(x);

  const isAllEasy =
    x.trainingPhase === "return_to_run" || x.limiter === "aerobic_base" || x.limiter === "long_endurance";
  const template = isAllEasy ? allEasyWeek(totalKm, x) : oneHighDayWeek(totalKm, x);
  const actualKm = [template.key_session, ...template.support_sessions].reduce((sum, s) => sum + s.planned_km, 0);
  const actualMinutes = [template.key_session, ...template.support_sessions].reduce(
    (sum, s) => sum + (s.planned_minutes ?? 0),
    0,
  );

  const explanation =
    `Coach v2 · ${x.trainingPhase.replaceAll("_", " ")}: ${x.limiterReason}. ` +
    `Planned running ${actualKm.toFixed(1)}km${actualMinutes > 0 ? ` / about ${actualMinutes} minutes` : ""} across ${x.runDays.length} days` +
    (x.previousWeekKm != null && x.previousWeekKm > 0
      ? ` (${Math.round((progression - 1) * 100)}% vs last week's ${x.previousWeekKm.toFixed(1)}km)`
      : " (no recent running baseline — conservative re-entry)") +
    (x.previousDecision ? `. Previous-week decision: ${x.previousDecision}.` : ".") +
    (x.strengthDays.length > 0
      ? ` Gym work is shown on ${x.strengthDays.length} inferred/configured days; lower-body days must be configured to optimize spacing.`
      : "") +
    ` Key session: ${template.key_session.title}.`;

  return { ...template, explanation };
}

function allEasyWeek(
  totalKm: number,
  x: WeekTemplateInput,
): Omit<WeekTemplate, "explanation"> {
  if (x.trainingPhase === "return_to_run") return returnToRunWeek(totalKm, x);

  // Raw (unrounded) shares sum to exactly totalKm by construction; floor each one so
  // independent per-session rounding can never push the SUM over the +10% cap (rounding
  // each to nearest can — see weekTemplate.test.ts for the case that caught this).
  const keyDay = keyRunDay(x.runDays, true);
  const easyDays = x.runDays.filter((d) => d !== keyDay);
  const rawKey = totalKm * longRunShare(x.runDays.length);
  const sessionCap = x.longestRunKm30d > 0 ? x.longestRunKm30d * 1.1 : 4;
  const rawEasy = easyDays.length > 0 ? (totalKm - rawKey) / easyDays.length : 0;
  const keyKm = floor1(Math.min(rawKey, sessionCap));
  const eachEasyKm = floor1(rawEasy);
  const effort = easyEffort(x);
  const keyTitle =
    x.limiter === "long_endurance" ? "Long run (building toward race distance)" : "Long run";

  const easy = (day: number): TemplateSession => ({
    day,
    title: "Easy run",
    description: `${eachEasyKm.toFixed(1)}km easy — ${effort}`,
    intensity: "low",
    planned_km: eachEasyKm,
  });

  return {
    target_limiter: x.limiter,
    key_session: {
      day: keyDay,
      title: keyTitle,
      description: `${keyKm.toFixed(1)}km continuous long run — ${effort} The week's main aerobic stimulus.`,
      intensity: "low",
      planned_km: keyKm,
    },
    support_sessions: calendarSupport(easyDays.map(easy), x, keyDay),
  };
}

/**
 * Re-entry is prescribed by time, not pace or distance. Walk breaks are legitimate;
 * planned_km is retained only for the existing validator/review contract and UI.
 */
function returnToRunWeek(
  totalKm: number,
  x: WeekTemplateInput,
): Omit<WeekTemplate, "explanation"> {
  const runDays = x.runDays.length > 0 ? x.runDays : [1, 3, 6];
  const keyDay = keyRunDay(runDays, true);
  const easyDays = runDays.filter((day) => day !== keyDay);
  const ratios = runDays.length === 3 ? [0.27, 0.33, 0.4] : runDays.map(() => 1 / runDays.length);
  const minutesBase = [20, 25, 30];
  const kmByDay = new Map<number, number>();
  const minutesByDay = new Map<number, number>();

  for (let i = 0; i < runDays.length; i++) {
    const day = runDays[i]!;
    const ratio = ratios[i] ?? 1 / runDays.length;
    const sessionCap = day === keyDay && x.longestRunKm30d > 0 ? x.longestRunKm30d * 1.1 : 4;
    const km = floor1(Math.min(totalKm * ratio, sessionCap));
    kmByDay.set(day, km);
    const baseMinutes = minutesBase[i] ?? Math.round(75 / runDays.length);
    // Duration tracks the (already session-capped) distance, not the raw weekly dose.
    // The key run's km is capped at 110% of the longest recent run; scaling minutes off
    // total volume instead let the LONGEST run's DURATION jump ~40% in a single week
    // (e.g. 30→43 min) even though its km was held to +10% — and made the copy
    // self-contradict ("43 min / 4.5km" implies a pace no easy run would hold). Anchoring
    // minutes to km keeps run/walk pace constant and inherits the same growth guardrail.
    const baseKm = DEFAULT_RETURN_KM * ratio;
    minutesByDay.set(day, Math.max(15, Math.round(baseMinutes * (km / baseKm))));
  }

  const effort = easyEffort(x);
  /**
   * Walk breaks are offered only for a session LONGER than anything covered recently.
   * Telling an athlete who just ran 5.8km unbroken that "walk breaks are allowed"
   * describes a body he no longer has, and reads as a demotion for a week he earned.
   * The caution of return-to-run belongs in the volume and the frequency — which are
   * unchanged here — not in copy that contradicts what the athlete just did. The
   * stop-if-pain clause is a safety line and stays on every session either way.
   */
  const makeEasy = (day: number, isKey: boolean): TemplateSession => {
    const km = kmByDay.get(day) ?? 0;
    const minutes = minutesByDay.get(day) ?? 20;
    const offerWalkBreaks = x.longestRunKm30d <= 0 || km > x.longestRunKm30d;
    const title = offerWalkBreaks
      ? isKey
        ? "Longest easy run/walk"
        : "Easy run/walk"
      : isKey
        ? "Longest easy run"
        : "Easy run";
    return {
      day,
      title,
      description:
        `${minutes} minutes easy${offerWalkBreaks ? " run/walk" : ""} (about ${km.toFixed(1)}km) — ${effort} ` +
        (offerWalkBreaks
          ? "Walk breaks are allowed; stop if pain changes your stride."
          : "Stop if pain changes your stride."),
      intensity: "low",
      planned_km: km,
      planned_minutes: minutes,
    };
  };

  return {
    target_limiter: x.limiter,
    key_session: makeEasy(keyDay, true),
    support_sessions: calendarSupport(easyDays.map((day) => makeEasy(day, false)), x, keyDay),
  };
}

function oneHighDayWeek(
  totalKm: number,
  x: WeekTemplateInput,
): Omit<WeekTemplate, "explanation"> {
  // Same floor-the-exact-shares approach as allEasyWeek — see the comment there.
  const keyDay = keyRunDay(x.runDays, false);
  const longDay = x.runDays.at(-1) ?? 6;
  const easyDays = x.runDays.filter((d) => d !== keyDay && d !== longDay);
  const rawHigh = totalKm * HIGH_SESSION_SHARE;
  const rawLong = totalKm * LONG_RUN_SHARE_SUPPORT;
  const rawEasy = easyDays.length > 0 ? (totalKm - rawHigh - rawLong) / easyDays.length : 0;
  const highKm = floor1(rawHigh);
  const longKm = floor1(rawLong);
  const eachEasyKm = floor1(rawEasy);
  const effort = easyEffort(x);
  const thresholdPace = paceSuffix(x.thresholdPaceSecPerKm);

  const easy = (day: number): TemplateSession => ({
    day,
    title: "Easy run",
    description: `${eachEasyKm.toFixed(1)}km easy — ${effort}`,
    intensity: "low",
    planned_km: eachEasyKm,
  });

  const keySession: TemplateSession =
    x.limiter === "threshold"
      ? {
          day: keyDay,
          title: "Threshold session",
          description: `${highKm.toFixed(1)}km total, including easy warm-up/cool-down and controlled threshold work${thresholdPace}. Keep the quality portion conservative (for example, short repeats with easy jog recovery).`,
          intensity: "high",
          planned_km: highKm,
        }
      : {
          day: keyDay,
          title: "Race-specific session",
          description: `${highKm.toFixed(1)}km including sustained race-effort surges — start folding in trail-specific terrain and pacing.`,
          intensity: "high",
          planned_km: highKm,
        };

  return {
    target_limiter: x.limiter,
    key_session: keySession,
    support_sessions: calendarSupport(
      [
        ...easyDays.map(easy),
        {
          day: longDay,
          title: "Long run",
          description: `${longKm.toFixed(1)}km long run — ${effort} Keep it honest even as it gets longer.`,
          intensity: "low" as const,
          planned_km: longKm,
        },
      ],
      x,
      keyDay,
    ),
  };
}

function calendarSupport(
  running: TemplateSession[],
  x: WeekTemplateInput,
  keyDay: number,
): TemplateSession[] {
  const sessions = [...running];
  for (const day of x.strengthDays) {
    const lower = x.lowerBodyStrengthDays.includes(day);
    sessions.push({
      day,
      title: lower ? "Lower-body strength" : "Strength training",
      description: lower
        ? "Configured lower-body gym session — report unusual leg soreness or pain so the next run can adapt."
        : "Usual gym session (inferred from recent history unless configured).",
      intensity: "low",
      planned_km: 0,
    });
  }
  for (let day = 0; day < 7; day++) {
    const hasWork = day === keyDay || sessions.some((s) => s.day === day && s.intensity !== "rest");
    if (!hasWork) sessions.push(rest(day));
  }
  return sessions.sort((a, b) => a.day - b.day || a.planned_km - b.planned_km);
}

/**
 * How to describe easy effort. HR leads when available — it self-normalizes to current
 * fitness, whereas a pace target derived from past fitness silently turns easy runs into
 * threshold work when you're detrained.
 */
function easyEffort(x: WeekTemplateInput): string {
  const pace = x.easyPaceSecPerKm != null ? paceOnly(x.easyPaceSecPerKm) : null;
  if (x.easyHrCeiling != null) {
    return `full-sentence conversational effort; keep HR under ${x.easyHrCeiling} bpm as a ceiling${pace ? ` (roughly ${pace}, but effort governs — slow down or walk as needed)` : ""}.`;
  }
  return `fully conversational effort${pace ? `, roughly ${pace}` : ""}.`;
}

/** Shared controller used by deterministic and LLM-backed plan paths. */
export function runningProgressionFactor(
  x: Pick<WeekTemplateInput, "trainingPhase" | "tsb" | "aerobicTsb" | "previousDecision">,
): number {
  if (x.trainingPhase === "taper") return 0.75;
  // Generic gym duration contributes to totalTsb but cannot tell us whether the
  // runner's legs are ready. Running/aerobic balance may guard progression; gym
  // only does so later through an explicit DELOAD/red flag or readiness signal.
  if (x.tsb < RUNNING_LOAD_GUARDRAIL || (x.aerobicTsb != null && x.aerobicTsb < RUNNING_LOAD_GUARDRAIL)) return 0.9;
  switch (x.previousDecision) {
    case "PROGRESS":
      return 1.05;
    case "DELOAD":
      return 0.8;
    case "REPEAT":
    case "PROCEED":
    case null:
      return 1;
  }
}

/**
 * Weeks the controller looks back over when recovering ground the athlete has already
 * covered. Long enough to survive a single interrupted week; short enough that it can
 * never resurrect a fitness level that has since decayed away.
 */
const RECENT_PEAK_WEEKS = 4;
/**
 * Fraction of a recent peak week the plan may return to directly. Returning to 80% of
 * a load COMPLETED within the last month is re-entry, not progression — and the
 * per-session caps in allEasyWeek/returnToRunWeek still hold any single run to +10% of
 * the longest recent run, which is where the injury evidence actually sits (BJSM 2025,
 * cited in NEXT_STEPS.md). Weekly totals and session length are separate guardrails.
 */
const RECENT_PEAK_RECOVERY_SHARE = 0.8;

/** Exact weekly running ceiling shared by both planner implementations. */
export function plannedRunVolumeCeiling(
  x: Pick<
    WeekTemplateInput,
    | "trainingPhase"
    | "previousWeekKm"
    | "recentWeeklyKm"
    | "trajectoryTargetKm"
    | "tsb"
    | "aerobicTsb"
    | "previousDecision"
  >,
): number {
  const defaultKm = x.trainingPhase === "return_to_run" ? DEFAULT_RETURN_KM : DEFAULT_STARTING_KM;
  const previousKm = x.previousWeekKm != null && x.previousWeekKm > 0 ? x.previousWeekKm : defaultKm;
  // Anchoring ONLY on last week made the plan a follower: one interrupted week reset
  // the baseline permanently, so the prescription ratcheted down below what the athlete
  // was already running unprompted (key session 5.4 -> 4.5 -> 1.6km against a 5.6km
  // longest run) and became safe to ignore. A taper never looks backwards for volume.
  const recentPeakKm = Math.max(0, ...(x.recentWeeklyKm ?? []).slice(-RECENT_PEAK_WEEKS));
  const baseline =
    x.trainingPhase === "taper"
      ? previousKm
      : Math.max(previousKm, recentPeakKm * RECENT_PEAK_RECOVERY_SHARE);
  const factor = runningProgressionFactor(x);
  const planned = baseline * factor;
  // The race trajectory may SHAPE growth the athlete has already earned — it must never
  // CREATE it. Readiness outranks the calendar (PROJECT.md; NEXT_STEPS "First coaching
  // verdict"), so a week that has not earned PROGRESS stays flat no matter how far
  // behind the curve it is: being behind is a reason to be told, not to be pushed. When
  // growth IS earned, the trajectory can lift it toward the target, still bounded by the
  // same +10% the S2 validator enforces.
  if (factor <= 1 || x.trajectoryTargetKm == null || x.trainingPhase === "taper") {
    return round1(planned);
  }
  return round1(Math.min(Math.max(planned, x.trajectoryTargetKm), baseline * MAX_WEEKLY_PROGRESSION));
}

/** "7:20/km" — no leading " @ ", for use mid-sentence. */
function paceOnly(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${s === 60 ? m + 1 : m}:${String(s === 60 ? 0 : s).padStart(2, "0")}/km`;
}

function rest(day: number): TemplateSession {
  return { day, title: "Rest", description: "Full rest — no training.", intensity: "rest", planned_km: 0 };
}

function paceSuffix(secPerKm: number | null): string {
  if (secPerKm == null) return "";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return ` @ ${s === 60 ? m + 1 : m}:${String(s === 60 ? 0 : s).padStart(2, "0")}/km`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Share of weekly volume the long run takes, floored so it stays clearly the longest
 * session of the week (see LONG_RUN_MIN_RATIO_TO_EVEN). Clamped to 1 so a one-run
 * week gives the whole dose to the key session instead of overflowing it.
 */
function longRunShare(runDayCount: number): number {
  if (runDayCount <= 0) return LONG_RUN_SHARE_BASE;
  return Math.min(1, Math.max(LONG_RUN_SHARE_BASE, LONG_RUN_MIN_RATIO_TO_EVEN / runDayCount));
}

/** Rounds DOWN to 1 decimal — used for per-session km so independently-rounded
 * sessions can never sum to more than the unrounded target (see call sites). */
function floor1(n: number): number {
  return Math.floor(n * 10 + 1e-9) / 10;
}
