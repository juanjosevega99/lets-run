/**
 * Energy cost of running on a gradient. Source: Minetti et al., "Energy cost of
 * walking and running at extreme uphill and downhill slopes", J Appl Physiol 93
 * (2002), eq. for running:
 *
 *   C(i) = 155.4i⁵ − 30.4i⁴ − 43.3i³ + 46.3i² + 19.5i + 3.6   [J/(kg·m)]
 *
 * with i the grade (rise/run, e.g. +0.10 = 10% up), fitted on i ∈ [−0.45, +0.45].
 * C(0) = 3.6 is the level-running cost; the ratio C(i)/C(0) converts real pace to
 * grade-adjusted pace (GAP) and course profiles to flat-equivalent time.
 */

export const LEVEL_COST = 3.6;
const GRADE_LIMIT = 0.45;

export function costOfGrade(grade: number): number {
  const i = Math.max(-GRADE_LIMIT, Math.min(GRADE_LIMIT, grade));
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
}

/** Multiplier on time/energy vs flat for a constant grade. >1 uphill, <1 moderate downhill. */
export function gapFactor(grade: number): number {
  return costOfGrade(grade) / LEVEL_COST;
}

/**
 * Course-level adjustment when only total climb is known (the usual case for a race
 * profile): model the course as half the distance at +i and half at −i, with
 * i = gain / (distance/2). Start≈finish elevation assumed (true for the Patagonia 21K:
 * ~50m → 22m). Returns the multiplier on flat time; 1.0 for a flat course.
 */
export function courseFactor(distanceM: number, elevationGainM: number): number {
  if (distanceM <= 0) throw new Error("courseFactor: distance must be positive");
  if (elevationGainM <= 0) return 1;
  const half = distanceM / 2;
  const i = elevationGainM / half;
  return (costOfGrade(i) + costOfGrade(-i)) / (2 * LEVEL_COST);
}
