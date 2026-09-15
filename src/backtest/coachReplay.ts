/**
 * Coach replay — the F2 backtest's twin, for the coach instead of the predictor.
 *
 * `npm run backtest` asks "would the predictor have got this race right?". Nothing
 * asked the equivalent question of the coaching side: **would the plan it produces have
 * made sense, week after week, for the athlete who actually lived those weeks?**
 *
 * That gap is why every defect in this model was found by hand. A human compared the
 * live plan against the real training log and noticed the plan had prescribed Tue/Thu/Sun
 * for five consecutive weeks to someone who ran Mon/Wed/Sun every time. The unit tests
 * could not see it because they test the template against invented inputs; the validator
 * could not see it because the week broke no rules.
 *
 * So: rebuild the world as it looked each Monday, generate the week the coach would have
 * prescribed, and check it against the S2 validator AND the coaching properties. Then
 * feed the athlete's REAL logged runs into the review, and carry the resulting decision
 * into the next week — so the replay reproduces the controller's actual feedback loop,
 * including its ratchets, rather than scoring each week in isolation.
 *
 * Everything here is pure. The CLI loads two tables and hands the rows over; no query
 * runs inside the simulation, which is what makes the whole thing testable without a
 * database.
 *
 * Leak-proofing: a week's context uses activities strictly BEFORE its Monday. The plan
 * for week W never sees a single metre run during W.
 */

import { buildWeekTemplate, plannedRunVolumeCeiling, type WeekTemplateInput } from "../deterministic/weekTemplate.js";
import {
  phaseRunDays,
  selectTrainingFocus,
  selectTrainingPhase,
  type TrainingPhase,
} from "../deterministic/trainingPhase.js";
import { isAllEasyWeek } from "../deterministic/schedule.js";
import { validateWeek, type PlannedSession, type Violation } from "../deterministic/validator.js";
import { checkCoachProperties, type CoachPropertyViolation } from "../deterministic/coachProperties.js";
import { reviewWeek, type WeekDecision } from "../plan/review.js";
import type { Limiter } from "../deterministic/limiter.js";

/** One activity, already bucketed into the athlete's local calendar by the loader. */
export interface ReplayActivity {
  /** YYYY-MM-DD in the athlete's timezone. */
  date: string;
  /** 0 = Monday … 6 = Sunday, in the athlete's timezone. */
  weekday: number;
  sport: "run" | "strength" | "other";
  km: number;
  minutes: number;
}

/** Training balance on a given day, as fitness_state recorded it. */
export interface ReplayFitness {
  date: string;
  tsb: number;
  aerobicTsb: number | null;
  totalTsb: number | null;
}

export interface ReplayOptions {
  raceDateIso: string;
  lowerBodyStrengthDays?: number[];
  /** Runs needed in the 90-day window before a weekday pattern is treated as signal. */
  minRunsToInferDays?: number;
}

export interface ReplayWeek {
  weekStart: string;
  phase: TrainingPhase;
  limiter: Limiter;
  limiterReason: string;
  runDays: number[];
  plannedKm: number;
  plannedRunSessions: number;
  actualKm: number;
  actualRunSessions: number;
  decision: WeekDecision;
  compliancePct: number;
  ruleViolations: Violation[];
  propertyViolations: CoachPropertyViolation[];
}

export interface CoachReplayResult {
  weeks: ReplayWeek[];
  ruleViolations: number;
  propertyViolations: number;
  /** Property name → how many weeks it fired in. */
  propertyCounts: Record<string, number>;
}

const MIN_RUNS_TO_INFER_DAYS = 6;
const DAY_MS = 86_400_000;

const addDays = (iso: string, days: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Mondays from the first activity week to the last, inclusive. */
export function replayWeekStarts(activities: ReplayActivity[]): string[] {
  if (activities.length === 0) return [];
  const dates = activities.map((a) => a.date).sort();
  let cursor = addDays(dates[0]!, -((activities.find((a) => a.date === dates[0]!)?.weekday ?? 0)));
  const lastDate = dates.at(-1)!;
  const out: string[] = [];
  while (daysBetween(cursor, lastDate) >= 0) {
    out.push(cursor);
    cursor = addDays(cursor, 7);
  }
  return out;
}

function kmBetween(activities: ReplayActivity[], fromIso: string, toIso: string): number {
  return activities
    .filter((a) => a.sport === "run" && a.date >= fromIso && a.date < toIso)
    .reduce((sum, a) => sum + a.km, 0);
}

/**
 * Every deterministic input the coach needs, as of `weekStart` — using nothing that
 * happened on or after it.
 */
export function weekContext(
  activities: ReplayActivity[],
  fitness: ReplayFitness[],
  weekStart: string,
  options: ReplayOptions,
) {
  const before = activities.filter((a) => a.date < weekStart);
  const runsBefore = before.filter((a) => a.sport === "run");

  const recentWeeklyKm = [4, 3, 2, 1].map((back) =>
    kmBetween(activities, addDays(weekStart, -7 * back), addDays(weekStart, -7 * (back - 1))),
  );
  const previousWeekKm = recentWeeklyKm.at(-1) ?? 0;
  const activeRunWeeks4 = recentWeeklyKm.filter((km) => km > 0).length;

  const since28 = addDays(weekStart, -28);
  const runs28d = runsBefore.filter((a) => a.date >= since28).length;
  const lastRun = runsBefore.at(-1)?.date ?? null;
  const daysSinceLastRun = lastRun == null ? null : daysBetween(lastRun, weekStart);

  const since30 = addDays(weekStart, -30);
  const longestRunKm30d = Math.max(
    0,
    ...runsBefore.filter((a) => a.date >= since30).map((a) => a.km),
  );

  // Habitual run weekdays, ranked — the same shape loadRunDays() uses in production.
  const since90 = addDays(weekStart, -90);
  const window90 = runsBefore.filter((a) => a.date >= since90);
  const byWeekday = new Map<number, { n: number; last: string }>();
  for (const a of window90) {
    const entry = byWeekday.get(a.weekday) ?? { n: 0, last: a.date };
    entry.n += 1;
    if (a.date > entry.last) entry.last = a.date;
    byWeekday.set(a.weekday, entry);
  }
  const preferredRunDays =
    window90.length < (options.minRunsToInferDays ?? MIN_RUNS_TO_INFER_DAYS)
      ? []
      : [...byWeekday.entries()]
          .sort((a, b) => b[1].n - a[1].n || (a[1].last < b[1].last ? 1 : -1))
          .map(([day]) => day);

  // Recurring gym weekdays, mirroring loadStrengthDays().
  const since120 = addDays(weekStart, -120);
  const gym = before.filter((a) => a.sport === "strength" && a.date >= since120);
  const gymCounts = new Map<number, number>();
  for (const a of gym) gymCounts.set(a.weekday, (gymCounts.get(a.weekday) ?? 0) + 1);
  const maxGym = Math.max(0, ...gymCounts.values());
  const strengthDays = [...gymCounts.entries()]
    .filter(([, n]) => n >= Math.max(2, maxGym * 0.5))
    .map(([day]) => day)
    .sort((a, b) => a - b);

  const balance = fitness.filter((f) => f.date < weekStart).at(-1) ?? null;

  return {
    previousWeekKm,
    recentWeeklyKm,
    activeRunWeeks4,
    runs28d,
    daysSinceLastRun,
    longestRunKm30d,
    preferredRunDays,
    strengthDays,
    lowerBodyStrengthDays: options.lowerBodyStrengthDays ?? [],
    tsb: balance?.tsb ?? 0,
    aerobicTsb: balance?.aerobicTsb ?? null,
    totalTsb: balance?.totalTsb ?? null,
    daysToRace: daysBetween(weekStart, options.raceDateIso),
  };
}

/** Forward simulation: each week's decision becomes the next week's input. */
export function replayCoach(
  activities: ReplayActivity[],
  fitness: ReplayFitness[],
  options: ReplayOptions,
): CoachReplayResult {
  const weeks: ReplayWeek[] = [];
  let previousDecision: WeekDecision | null = null;

  for (const weekStart of replayWeekStarts(activities)) {
    const ctx = weekContext(activities, fitness, weekStart, options);
    const phase = selectTrainingPhase({
      daysToRace: ctx.daysToRace,
      daysSinceLastRun: ctx.daysSinceLastRun,
      runs28d: ctx.runs28d,
      activeRunWeeks4: ctx.activeRunWeeks4,
    });
    const limiter = selectTrainingFocus({
      phase,
      daysToRace: ctx.daysToRace,
      daysSinceLastRun: ctx.daysSinceLastRun,
      runs28d: ctx.runs28d,
      activeRunWeeks4: ctx.activeRunWeeks4,
      longestRunKm30d: ctx.longestRunKm30d,
      raceKm: 21.0975,
      // Threshold exposure needs HR streams; the replay deliberately leaves it unknown
      // rather than approximating, which keeps the focus conservative.
      qualityShare28d: null,
    });
    const allEasy = isAllEasyWeek(phase, limiter.limiter);
    const runDays = phaseRunDays(phase, ctx.lowerBodyStrengthDays, allEasy, ctx.runs28d, ctx.preferredRunDays);

    const input: WeekTemplateInput = {
      limiter: limiter.limiter,
      limiterReason: limiter.reason,
      trainingPhase: phase,
      previousWeekKm: ctx.previousWeekKm,
      recentWeeklyKm: ctx.recentWeeklyKm,
      tsb: ctx.tsb,
      aerobicTsb: ctx.aerobicTsb,
      totalTsb: ctx.totalTsb,
      previousDecision,
      runDays,
      strengthDays: ctx.strengthDays,
      lowerBodyStrengthDays: ctx.lowerBodyStrengthDays,
      longestRunKm30d: ctx.longestRunKm30d,
      easyPaceSecPerKm: null,
      thresholdPaceSecPerKm: null,
    };
    const plan = buildWeekTemplate(input);
    const sessions: PlannedSession[] = [plan.key_session, ...plan.support_sessions].map((s) => ({
      day: s.day,
      title: s.title,
      intensity: s.intensity,
      plannedKm: s.planned_km,
      plannedMinutes: s.planned_minutes,
    }));
    const keySession = sessions.find((s) => s.title === plan.key_session.title) ?? sessions[0]!;

    const ruleViolations = validateWeek({
      sessions,
      previousWeekKm: ctx.previousWeekKm,
      trainingPhase: phase,
      // Production passes the controller's own ceiling. Without it the validator falls
      // back to legacy +10%-of-last-week, which rejects the deliberate recovery weeks
      // plannedRunVolumeCeiling exists to produce.
      maxPlannedRunKm: plannedRunVolumeCeiling(input),
      longestRunKm30d: ctx.longestRunKm30d,
      keySessionDay: plan.key_session.day,
      lowerBodyStrengthDays: ctx.lowerBodyStrengthDays,
      requiredStrengthDays: ctx.strengthDays,
    });
    const propertyViolations = checkCoachProperties({
      sessions,
      keySession,
      trainingPhase: phase,
      previousDecision,
      previousWeekKm: ctx.previousWeekKm,
      recentWeeklyKm: ctx.recentWeeklyKm,
      longestRunKm30d: ctx.longestRunKm30d,
      preferredRunDays: ctx.preferredRunDays,
    });

    // The athlete's REAL week, aggregated per day exactly as the live review does.
    const weekEnd = addDays(weekStart, 7);
    const actual = activities.filter((a) => a.sport === "run" && a.date >= weekStart && a.date < weekEnd);
    const byDay = new Map<number, { day: number; distanceKm: number; durationMinutes: number }>();
    for (const a of actual) {
      const bucket = byDay.get(a.weekday) ?? { day: a.weekday, distanceKm: 0, durationMinutes: 0 };
      bucket.distanceKm += a.km;
      bucket.durationMinutes += a.minutes;
      byDay.set(a.weekday, bucket);
    }
    const review = reviewWeek({
      sessions,
      keySession,
      actualRuns: [...byDay.values()].sort((a, b) => a.day - b.day),
      keyMatchesAnyDay: sessions.every((s) => s.intensity !== "high"),
      // No historical check-ins exist, so readiness is never confirmed — the replay
      // reproduces the real controller, which has been running without them.
    });

    weeks.push({
      weekStart,
      phase,
      limiter: limiter.limiter,
      limiterReason: limiter.reason,
      runDays,
      plannedKm: sessions.reduce((sum, s) => sum + s.plannedKm, 0),
      plannedRunSessions: sessions.filter((s) => s.plannedKm > 0 || (s.plannedMinutes ?? 0) > 0).length,
      actualKm: actual.reduce((sum, a) => sum + a.km, 0),
      actualRunSessions: actual.length,
      decision: review.decision,
      compliancePct: review.compliancePct,
      ruleViolations,
      propertyViolations,
    });
    previousDecision = review.decision;
  }

  const propertyCounts: Record<string, number> = {};
  for (const w of weeks) {
    for (const p of new Set(w.propertyViolations.map((v) => v.property))) {
      propertyCounts[p] = (propertyCounts[p] ?? 0) + 1;
    }
  }
  return {
    weeks,
    ruleViolations: weeks.reduce((sum, w) => sum + w.ruleViolations.length, 0),
    propertyViolations: weeks.reduce((sum, w) => sum + w.propertyViolations.length, 0),
    propertyCounts,
  };
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function formatCoachReplay(result: CoachReplayResult, onlyProblems = false): string {
  const lines: string[] = [];
  lines.push("week        phase            plan    actual  days         decision  issues");
  lines.push("─".repeat(88));
  for (const w of result.weeks) {
    const issues = [...w.ruleViolations.map((v) => `RULE:${v.rule}`), ...w.propertyViolations.map((v) => v.property)];
    if (onlyProblems && issues.length === 0) continue;
    lines.push(
      `${w.weekStart}  ${w.phase.padEnd(15)} ${`${w.plannedKm.toFixed(1)}km`.padStart(7)} ` +
        `${`${w.actualKm.toFixed(1)}km`.padStart(7)}  ${w.runDays.map((d) => DAY_NAMES[d]).join("").padEnd(12)} ` +
        `${w.decision.padEnd(9)} ${issues.join(", ")}`,
    );
  }
  lines.push("");
  lines.push(`${result.weeks.length} weeks replayed · ${result.ruleViolations} rule violations · ${result.propertyViolations} property violations`);
  const counts = Object.entries(result.propertyCounts).sort((a, b) => b[1] - a[1]);
  if (counts.length > 0) {
    lines.push("");
    lines.push("properties, by weeks affected:");
    for (const [property, n] of counts) lines.push(`  ${String(n).padStart(3)}  ${property}`);
  }
  return lines.join("\n");
}
