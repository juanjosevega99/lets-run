/**
 * Banister impulse-response fitness/fatigue, in its TrainingPeaks-popularized EWMA form:
 *
 *   CTL_d = CTL_{d-1} + (load_d − CTL_{d-1}) / 42     (chronic "fitness", 42-day tc)
 *   ATL_d = ATL_{d-1} + (load_d − ATL_{d-1}) / 7      (acute "fatigue", 7-day tc)
 *   TSB_d = CTL_d − ATL_d                             (post-day load balance)
 *
 * Coach v2 keeps like-with-like curves:
 *   - ctl/atl/tsb: running-specific load on BOTH sides of the form equation
 *   - aerobicCtl/aerobicAtl: transferable aerobic load (run/ride/swim/etc.)
 *   - totalCtl/totalAtl/totalTsb: like-with-like whole-program load context
 *
 * The old implementation subtracted all-sport ATL from running-only CTL. That made
 * a cycling or gym block create a structurally negative TSB even though the two
 * operands represented different qualities. totalAtl remains visible as context,
 * but is never called "form" and is not subtracted from running CTL.
 */

export interface DailyLoad {
  day: string; // YYYY-MM-DD
  runningStress: number;
  aerobicStress?: number;
  totalStress: number;
}

export interface FitnessDay {
  day: string;
  ctl: number; // running fitness
  atl: number; // running-specific acute load
  tsb: number; // post-day running load balance: running CTL − running ATL
  aerobicCtl: number;
  aerobicAtl: number;
  totalCtl: number;
  totalAtl: number;
  totalTsb: number;
  runningLoad: number;
  aerobicLoad: number;
  totalLoad: number;
}

export const CTL_TC = 42;
export const ATL_TC = 7;

/**
 * days must be consecutive calendar days (zero-filled — a rest day is a real day of
 * decay, so gaps must be present as zero-load days, not skipped).
 */
export function banisterSeries(days: DailyLoad[]): FitnessDay[] {
  let ctl = 0;
  let atl = 0;
  let aerobicCtl = 0;
  let aerobicAtl = 0;
  let totalCtl = 0;
  let totalAtl = 0;
  const out: FitnessDay[] = [];
  for (const d of days) {
    const aerobicLoad = d.aerobicStress ?? d.runningStress;
    ctl = ctl + (d.runningStress - ctl) / CTL_TC;
    atl = atl + (d.runningStress - atl) / ATL_TC;
    aerobicCtl = aerobicCtl + (aerobicLoad - aerobicCtl) / CTL_TC;
    aerobicAtl = aerobicAtl + (aerobicLoad - aerobicAtl) / ATL_TC;
    totalCtl = totalCtl + (d.totalStress - totalCtl) / CTL_TC;
    totalAtl = totalAtl + (d.totalStress - totalAtl) / ATL_TC;
    // Each row is internally consistent and includes that day's completed work.
    // Consumers planning tomorrow/next week must not read a pre-session balance.
    const tsb = ctl - atl;
    const totalTsb = totalCtl - totalAtl;
    out.push({
      day: d.day,
      ctl,
      atl,
      tsb,
      aerobicCtl,
      aerobicAtl,
      totalCtl,
      totalAtl,
      totalTsb,
      runningLoad: d.runningStress,
      aerobicLoad,
      totalLoad: d.totalStress,
    });
  }
  return out;
}

/** Zero-fill a sparse day→load map into consecutive days over [firstDay, lastDay]. */
export function fillDays(
  loads: Map<string, { runningStress: number; aerobicStress?: number; totalStress: number }>,
  firstDay: string,
  lastDay: string,
): DailyLoad[] {
  const out: DailyLoad[] = [];
  const cursor = new Date(`${firstDay}T00:00:00Z`);
  const end = new Date(`${lastDay}T00:00:00Z`);
  if (cursor.getTime() > end.getTime()) throw new Error("fillDays: firstDay after lastDay");
  while (cursor.getTime() <= end.getTime()) {
    const day = cursor.toISOString().slice(0, 10);
    const l = loads.get(day);
    out.push({
      day,
      runningStress: l?.runningStress ?? 0,
      aerobicStress: l?.aerobicStress ?? l?.runningStress ?? 0,
      totalStress: l?.totalStress ?? 0,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
