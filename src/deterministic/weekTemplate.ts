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
  tsb: number;
  totalAtl?: number | null;
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
const LONG_RUN_SHARE_SUPPORT = 0.28; // long run as a support session (threshold/race_specific weeks)

export function buildWeekTemplate(x: WeekTemplateInput): WeekTemplate {
  const defaultKm = x.trainingPhase === "return_to_run" ? DEFAULT_RETURN_KM : DEFAULT_STARTING_KM;
  const baseline = x.previousWeekKm && x.previousWeekKm > 0 ? x.previousWeekKm : defaultKm;
  // Progression is earned by completed training, not granted automatically. Running
  // TSB is a guardrail only; total multi-sport acute load is reported separately.
  const progression = progressionFor(x);
  const totalKm = round1(baseline * progression);

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
  const keyDay = x.runDays.at(-1) ?? 6;
  const easyDays = x.runDays.filter((d) => d !== keyDay);
  const rawKey = totalKm * LONG_RUN_SHARE_BASE;
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
  const keyDay = runDays.at(-1) ?? 6;
  const easyDays = runDays.filter((day) => day !== keyDay);
  const ratios = runDays.length === 3 ? [0.27, 0.33, 0.4] : runDays.map(() => 1 / runDays.length);
  const minutesBase = [20, 25, 30];
  const doseScale = totalKm / DEFAULT_RETURN_KM;
  const kmByDay = new Map<number, number>();
  const minutesByDay = new Map<number, number>();

  for (let i = 0; i < runDays.length; i++) {
    const day = runDays[i]!;
    const ratio = ratios[i] ?? 1 / runDays.length;
    const sessionCap = day === keyDay && x.longestRunKm30d > 0 ? x.longestRunKm30d * 1.1 : 4;
    kmByDay.set(day, floor1(Math.min(totalKm * ratio, sessionCap)));
    const baseMinutes = minutesBase[i] ?? Math.round(75 / runDays.length);
    minutesByDay.set(day, Math.max(15, Math.round(baseMinutes * doseScale)));
  }

  const effort = easyEffort(x);
  const makeEasy = (day: number, isKey: boolean): TemplateSession => {
    const km = kmByDay.get(day) ?? 0;
    const minutes = minutesByDay.get(day) ?? 20;
    return {
      day,
      title: isKey ? "Longest easy run/walk" : "Easy run/walk",
      description: `${minutes} minutes easy run/walk (about ${km.toFixed(1)}km) — ${effort} Walk breaks are allowed; stop if pain changes your stride.`,
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
  const keyDay = x.runDays.length >= 3 ? x.runDays[1]! : x.runDays[0] ?? 2;
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
          description: `${highKm.toFixed(1)}km at threshold effort${thresholdPace} (e.g. 3x10min with easy jog recovery), easy jog before/after not included.`,
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
        ? "Configured lower-body gym session — keep the following run easy and report leg soreness."
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

function progressionFor(x: WeekTemplateInput): number {
  if (x.trainingPhase === "taper") return 0.75;
  if (x.tsb < -20 || (x.totalTsb != null && x.totalTsb < -25)) return 0.9;
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

/** Rounds DOWN to 1 decimal — used for per-session km so independently-rounded
 * sessions can never sum to more than the unrounded target (see call sites). */
function floor1(n: number): number {
  return Math.floor(n * 10 + 1e-9) / 10;
}
