/**
 * Deterministic week template — the free, no-LLM alternative to F3's plan/generate.ts.
 * Same inputs (limiter, fitness, paces), same output shape, same S2 validator — the
 * only difference is *how* the week is filled in: fixed percentage splits instead of
 * an LLM's judgment. No API call, ever. This is the F-A stand-in taken one step
 * further than limiter.ts: not just "what's the limiter" but "what does a week that
 * respects it actually look like."
 *
 * Deliberately conservative: 5 running days, 2 rest days, at most one high-intensity
 * session, well inside the S2 validator's limits rather than pushed to their edge.
 */

import type { Limiter } from "./limiter.js";

export interface TemplateSession {
  day: number; // 0 = Monday … 6 = Sunday
  title: string;
  description: string;
  intensity: "low" | "high" | "rest";
  planned_km: number;
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
  previousWeekKm: number | null;
  tsb: number;
  easyPaceSecPerKm: number | null;
  thresholdPaceSecPerKm: number | null;
  /**
   * Do-not-exceed HR for easy running. When present it is quoted as the PRIMARY
   * control and pace is demoted to a guide — heart rate is self-normalizing to
   * current fitness, a pace number isn't.
   */
  easyHrCeiling?: number | null;
}

const DEFAULT_STARTING_KM = 12; // conservative first week with no volume baseline at all
const HIGH_SESSION_SHARE = 0.18; // well under the validator's 25% high-intensity ceiling
const LONG_RUN_SHARE_BASE = 0.3; // aerobic_base / long_endurance key session
const LONG_RUN_SHARE_SUPPORT = 0.28; // long run as a support session (threshold/race_specific weeks)

export function buildWeekTemplate(x: WeekTemplateInput): WeekTemplate {
  const baseline = x.previousWeekKm && x.previousWeekKm > 0 ? x.previousWeekKm : DEFAULT_STARTING_KM;
  // Fatigue-aware progression: don't spend the full +10% allowance while carrying
  // real accumulated fatigue (e.g. a heavy cross-training weekend).
  const progression = x.tsb < -20 ? 1.0 : x.tsb < -10 ? 1.05 : 1.1;
  const totalKm = round1(baseline * progression);

  const isAllEasy = x.limiter === "aerobic_base" || x.limiter === "long_endurance";
  const template = isAllEasy ? allEasyWeek(totalKm, x) : oneHighDayWeek(totalKm, x);

  const explanation =
    `Deterministic template (no LLM call): ${x.limiterReason}. ` +
    `Total volume ${totalKm.toFixed(1)}km` +
    (x.previousWeekKm ? ` (${Math.round((progression - 1) * 100)}% vs last week's ${x.previousWeekKm.toFixed(1)}km)` : " (no prior week on record — starting conservative)") +
    (x.tsb < -20 ? `. TSB ${x.tsb.toFixed(1)} is deeply negative, so growth was held flat this week.` : "") +
    ` Key session: ${template.key_session.title}.`;

  return { ...template, explanation };
}

function allEasyWeek(
  totalKm: number,
  x: WeekTemplateInput,
): Omit<WeekTemplate, "explanation"> {
  // Raw (unrounded) shares sum to exactly totalKm by construction; floor each one so
  // independent per-session rounding can never push the SUM over the +10% cap (rounding
  // each to nearest can — see weekTemplate.test.ts for the case that caught this).
  const rawKey = totalKm * LONG_RUN_SHARE_BASE;
  const rawEasy = (totalKm - rawKey) / 4;
  const keyKm = floor1(rawKey);
  const eachEasyKm = floor1(rawEasy);
  const effort = easyEffort(x);
  const keyTitle = x.limiter === "long_endurance" ? "Long run (building toward race distance)" : "Long run";

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
      day: 6,
      title: keyTitle,
      description: `${keyKm.toFixed(1)}km continuous long run — ${effort} The week's main aerobic stimulus.`,
      intensity: "low",
      planned_km: keyKm,
    },
    support_sessions: [
      easy(0),
      rest(1),
      easy(2),
      easy(3),
      rest(4),
      easy(5),
    ],
  };
}

function oneHighDayWeek(
  totalKm: number,
  x: WeekTemplateInput,
): Omit<WeekTemplate, "explanation"> {
  // Same floor-the-exact-shares approach as allEasyWeek — see the comment there.
  const rawHigh = totalKm * HIGH_SESSION_SHARE;
  const rawLong = totalKm * LONG_RUN_SHARE_SUPPORT;
  const rawEasy = (totalKm - rawHigh - rawLong) / 3;
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
          day: 3,
          title: "Threshold session",
          description: `${highKm.toFixed(1)}km at threshold effort${thresholdPace} (e.g. 3x10min with easy jog recovery), easy jog before/after not included.`,
          intensity: "high",
          planned_km: highKm,
        }
      : {
          day: 3,
          title: "Race-specific session",
          description: `${highKm.toFixed(1)}km including sustained race-effort surges — start folding in trail-specific terrain and pacing.`,
          intensity: "high",
          planned_km: highKm,
        };

  return {
    target_limiter: x.limiter,
    key_session: keySession,
    support_sessions: [
      easy(0),
      rest(1),
      easy(2),
      rest(4),
      easy(5),
      {
        day: 6,
        title: "Long run",
        description: `${longKm.toFixed(1)}km long run — ${effort} Keep it honest even as it gets longer.`,
        intensity: "low",
        planned_km: longKm,
      },
    ],
  };
}

/**
 * How to describe easy effort. HR leads when available — it self-normalizes to current
 * fitness, whereas a pace target derived from past fitness silently turns easy runs into
 * threshold work when you're detrained.
 */
function easyEffort(x: WeekTemplateInput): string {
  const pace = x.easyPaceSecPerKm != null ? paceOnly(x.easyPaceSecPerKm) : null;
  if (x.easyHrCeiling != null) {
    return `keep HR under ${x.easyHrCeiling} bpm${pace ? ` (roughly ${pace}, but HR governs — slow down or walk to stay under)` : ", conversational effort"}.`;
  }
  return `fully conversational effort${pace ? `, roughly ${pace}` : ""}.`;
}

/** "7:20/km" — no leading " @ ", for use mid-sentence. */
function paceOnly(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}

function rest(day: number): TemplateSession {
  return { day, title: "Rest", description: "Full rest — no training.", intensity: "rest", planned_km: 0 };
}

function paceSuffix(secPerKm: number | null): string {
  if (secPerKm == null) return "";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return ` @ ${m}:${String(s).padStart(2, "0")}/km`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Rounds DOWN to 1 decimal — used for per-session km so independently-rounded
 * sessions can never sum to more than the unrounded target (see call sites). */
function floor1(n: number): number {
  return Math.floor(n * 10 + 1e-9) / 10;
}
