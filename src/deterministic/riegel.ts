/**
 * Riegel distance extrapolation. Source: P. Riegel, "Athletic Records and Human
 * Endurance", American Scientist 69 (1981): T2 = T1 · (D2/D1)^b, b ≈ 1.06 for
 * trained runners across ~3.5min–4h efforts.
 */

export const RIEGEL_DEFAULT_EXPONENT = 1.06;

/** Sanity bounds for a fitted personal exponent; outside this the fit is noise. */
export const RIEGEL_EXPONENT_MIN = 1.02;
export const RIEGEL_EXPONENT_MAX = 1.15;

export function riegelPredict(
  knownTimeS: number,
  knownDistanceM: number,
  targetDistanceM: number,
  exponent: number = RIEGEL_DEFAULT_EXPONENT,
): number {
  if (knownTimeS <= 0 || knownDistanceM <= 0 || targetDistanceM <= 0) {
    throw new Error("riegelPredict: time and distances must be positive");
  }
  return knownTimeS * Math.pow(targetDistanceM / knownDistanceM, exponent);
}

export interface RacePerformance {
  distanceM: number;
  timeS: number;
}

/**
 * Personal exponent from race pairs: for each pair with meaningfully different
 * distances, b = ln(T2/T1) / ln(D2/D1); take the median (robust to one bad race)
 * and clamp to sanity bounds. Returns the default when fewer than 2 usable pairs.
 */
export function fitRiegelExponent(races: RacePerformance[]): number {
  const bs: number[] = [];
  for (let i = 0; i < races.length; i++) {
    for (let j = i + 1; j < races.length; j++) {
      const a = races[i]!;
      const b = races[j]!;
      const distRatio = b.distanceM / a.distanceM;
      // pairs closer than 20% in distance carry more noise than signal
      if (distRatio > 0.8333 && distRatio < 1.2) continue;
      const exp = Math.log(b.timeS / a.timeS) / Math.log(distRatio);
      if (Number.isFinite(exp)) bs.push(exp);
    }
  }
  if (bs.length === 0) return RIEGEL_DEFAULT_EXPONENT;
  bs.sort((x, y) => x - y);
  const mid = Math.floor(bs.length / 2);
  const median = bs.length % 2 === 1 ? bs[mid]! : (bs[mid - 1]! + bs[mid]!) / 2;
  return Math.min(RIEGEL_EXPONENT_MAX, Math.max(RIEGEL_EXPONENT_MIN, median));
}
