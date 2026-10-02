/**
 * Milestones — reinforcement for the things that actually build this athlete's race,
 * worded so that every claim is true.
 *
 * Three markers, chosen because each is the binding constraint on something real:
 *  - the long run, which is the one number that has to grow before the race estimate
 *    unlocks and before threshold work is earned;
 *  - consecutive 3-run weeks, the re-anchored primary goal and the variable his
 *    history says actually decides the outcome;
 *  - distance still needed to unlock the race estimate.
 *
 * What is deliberately absent: "you got faster" / "you're stronger". A pace or
 * threshold change from one session is far more often a first measurement than an
 * improvement, and a dashboard that says otherwise teaches the athlete to chase it.
 */

export interface DatedRun {
  date: string; // YYYY-MM-DD, athlete-local
  km: number;
}

export interface LongRunMilestone {
  km: number;
  date: string;
  /** Date of the last run that went further; null if none on record. */
  longestSince: string | null;
}

/** How recent a long run must be to be announced as news. */
export const LONG_RUN_NEWS_DAYS = 14;
/** And it must top at least this much history before it, or it is not a milestone. */
export const LONG_RUN_MIN_LOOKBACK_DAYS = 30;

const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/**
 * The longest run of the last two weeks — if it beats everything for at least a month
 * before it. "Longest since <date>" is used instead of "longest ever" because for an
 * athlete with half marathons on record, "longest ever" is never true and a
 * rebuild-relative claim is the one that means something.
 */
export function longRunMilestone(runs: DatedRun[], today: string): LongRunMilestone | null {
  const recent = runs.filter((r) => daysBetween(r.date, today) >= 0 && daysBetween(r.date, today) <= LONG_RUN_NEWS_DAYS);
  if (recent.length === 0) return null;
  const top = recent.reduce((best, r) => (r.km > best.km ? r : best));
  const longer = runs
    .filter((r) => r.date < top.date && r.km > top.km)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (longer && daysBetween(longer.date, top.date) < LONG_RUN_MIN_LOOKBACK_DAYS) return null;
  return { km: top.km, date: top.date, longestSince: longer?.date ?? null };
}

export interface WeekCount {
  weekStart: string;
  runs: number;
}

export interface Streak {
  current: number;
  best: number;
  target: number;
  /** True when the in-progress week already counts toward `current`. */
  includesThisWeek: boolean;
}

export const STREAK_MIN_RUNS = 3;
/** The re-anchored primary goal (NEXT_STEPS "Where the goal actually stands"). */
export const STREAK_TARGET_WEEKS = 12;

/**
 * Consecutive weeks with at least three runs. `weeks` is oldest first and its LAST
 * entry is the week in progress: that one counts once it has qualified, and never
 * breaks the streak while it is still under way — "you have not run three times yet
 * this Wednesday" is not a broken streak.
 */
export function consistencyStreak(weeks: WeekCount[]): Streak {
  const completed = weeks.slice(0, -1);
  const thisWeek = weeks.at(-1);
  let best = 0;
  let run = 0;
  for (const w of completed) {
    run = w.runs >= STREAK_MIN_RUNS ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const includesThisWeek = thisWeek != null && thisWeek.runs >= STREAK_MIN_RUNS;
  const current = run + (includesThisWeek ? 1 : 0);
  return { current, best: Math.max(best, current), target: STREAK_TARGET_WEEKS, includesThisWeek };
}

export interface EstimateUnlock {
  unlocked: boolean;
  neededKm: number;
  remainingKm: number;
}

/** Distance the reliability gate needs before a race estimate is shown. */
export function estimateUnlock(longestRunKm30d: number, raceKm: number, maxExtrapolation: number): EstimateUnlock {
  const neededKm = raceKm / maxExtrapolation;
  const remainingKm = Math.max(0, neededKm - longestRunKm30d);
  return { unlocked: remainingKm <= 0, neededKm, remainingKm };
}
