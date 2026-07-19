/**
 * VDOT — Daniels/Gilbert running economy model ("Oxygen Power", 1979; popularized in
 * Daniels' Running Formula). Two published curves:
 *
 *   vo2(v)  = -4.60 + 0.182258·v + 0.000104·v²          (v in m/min → ml/kg/min)
 *   frac(t) = 0.8 + 0.1894393·e^(-0.012778·t) + 0.2989558·e^(-0.1932605·t)
 *             (t in MINUTES → sustainable fraction of VO2max)
 *
 * VDOT of a race = vo2(speed) / frac(duration). Predicting a time at a distance
 * inverts that numerically (monotonic in T → bisection).
 */

export function vo2AtVelocity(vMPerMin: number): number {
  return -4.6 + 0.182258 * vMPerMin + 0.000104 * vMPerMin * vMPerMin;
}

export function sustainableFraction(tMinutes: number): number {
  return (
    0.8 + 0.1894393 * Math.exp(-0.012778 * tMinutes) + 0.2989558 * Math.exp(-0.1932605 * tMinutes)
  );
}

export function vdotFromRace(distanceM: number, timeS: number): number {
  if (distanceM <= 0 || timeS <= 0) throw new Error("vdotFromRace: inputs must be positive");
  const tMin = timeS / 60;
  return vo2AtVelocity(distanceM / tMin) / sustainableFraction(tMin);
}

/** Time (seconds) a runner of the given VDOT needs for the distance. Bisection on T. */
export function predictTimeS(vdot: number, distanceM: number): number {
  if (vdot <= 0 || distanceM <= 0) throw new Error("predictTimeS: inputs must be positive");
  // implied VDOT decreases as allowed time grows → bisect where implied − target crosses 0
  let loMin = distanceM / 600; // 600 m/min ≈ 1:40/km — faster than any human
  let hiMin = distanceM / 50; //   50 m/min ≈ 20:00/km — slower than walking
  for (let i = 0; i < 80; i++) {
    const mid = (loMin + hiMin) / 2;
    const implied = vo2AtVelocity(distanceM / mid) / sustainableFraction(mid);
    if (implied > vdot) loMin = mid;
    else hiMin = mid;
  }
  return ((loMin + hiMin) / 2) * 60;
}

/** Velocity (m/min) that demands the given fraction of a VDOT — for training paces. */
export function velocityAtFraction(vdot: number, fraction: number): number {
  const target = vdot * fraction;
  // solve 0.000104·v² + 0.182258·v − (4.6 + target) = 0, positive root
  const a = 0.000104;
  const b = 0.182258;
  const c = -(4.6 + target);
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

export interface TrainingPaces {
  easySecPerKm: number;
  marathonSecPerKm: number;
  thresholdSecPerKm: number;
  intervalSecPerKm: number;
}

/**
 * Training paces as fixed points inside Daniels' published intensity bands
 * (E 59–74%, M 75–84%, T 83–88%, I 95–100% of VDOT). Midpoint-ish approximations
 * of the book's tables, not a reproduction of them.
 */
export function trainingPaces(vdot: number): TrainingPaces {
  const secPerKm = (frac: number) => 60000 / velocityAtFraction(vdot, frac);
  return {
    easySecPerKm: secPerKm(0.7),
    marathonSecPerKm: secPerKm(0.82),
    thresholdSecPerKm: secPerKm(0.86),
    intervalSecPerKm: secPerKm(0.975),
  };
}
