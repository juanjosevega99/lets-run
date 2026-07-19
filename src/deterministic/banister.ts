/**
 * Banister impulse-response fitness/fatigue, in its TrainingPeaks-popularized EWMA form:
 *
 *   CTL_d = CTL_{d-1} + (load_d − CTL_{d-1}) / 42     (chronic "fitness", 42-day tc)
 *   ATL_d = ATL_{d-1} + (load_d − ATL_{d-1}) / 7      (acute "fatigue", 7-day tc)
 *   TSB_d = CTL_{d-1} − ATL_{d-1}                     (form going INTO day d)
 *
 * PROJECT.md §6 split: running CTL grows only from RUNNING stress (gym/rides build no
 * running-specific fitness — conservative, zero cross-transfer credit, documented);
 * ATL/fatigue accumulates from ALL stress.
 */

export interface DailyLoad {
  day: string; // YYYY-MM-DD
  runningStress: number;
  totalStress: number;
}

export interface FitnessDay {
  day: string;
  ctl: number; // running fitness
  atl: number; // whole-body fatigue
  tsb: number;
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
  const out: FitnessDay[] = [];
  for (const d of days) {
    const tsb = ctl - atl; // form entering the day, before today's training lands
    ctl = ctl + (d.runningStress - ctl) / CTL_TC;
    atl = atl + (d.totalStress - atl) / ATL_TC;
    out.push({ day: d.day, ctl, atl, tsb });
  }
  return out;
}

/** Zero-fill a sparse day→load map into consecutive days over [firstDay, lastDay]. */
export function fillDays(
  loads: Map<string, { runningStress: number; totalStress: number }>,
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
    out.push({ day, runningStress: l?.runningStress ?? 0, totalStress: l?.totalStress ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
