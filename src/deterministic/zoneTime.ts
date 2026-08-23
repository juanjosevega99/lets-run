import { bandForHr, type HrBand, type HrBandKey } from "./zones.js";

/**
 * Time-and-distance-in-zone from a per-sample HR stream.
 *
 * Why this exists: average HR hides the shape of a run. A 35-minute run averaging
 * 151 bpm can be 82% easy with a late drift, or half easy and half grey-zone — the
 * same average, very different training. Binning each sample interval against the
 * athlete's own bands is what makes "how much of this run was actually easy?"
 * answerable, and it is what the dashboard's zone view reports.
 *
 * Distance is accumulated per band alongside time so an OBSERVED pace per zone can be
 * derived — the honest answer to "what pace is my easy pace?" is whatever pace the
 * athlete actually held while their heart rate was in the easy band.
 */

export interface ZoneStream {
  /** Seconds from activity start, ascending. */
  timeS: number[];
  /** Cumulative metres, same length as timeS. */
  distanceM: number[];
  /** Heart rate per sample, same length as timeS. */
  heartrate: number[];
}

export interface ZoneSlice {
  seconds: number;
  meters: number;
}

export type ZoneTotals = Record<HrBandKey, ZoneSlice>;

/** Ignore absurd sample gaps (device pause, lost signal) rather than crediting them. */
export const MAX_SAMPLE_GAP_S = 30;

export function emptyZoneTotals(): ZoneTotals {
  return {
    recovery: { seconds: 0, meters: 0 },
    easy: { seconds: 0, meters: 0 },
    moderate: { seconds: 0, meters: 0 },
    threshold: { seconds: 0, meters: 0 },
  };
}

/**
 * Accumulate one activity's stream into `into` (so several runs can be summed).
 * Each interval is credited to the band of the heart rate at its END — the sample
 * that describes the effort just performed.
 */
export function accumulateZoneTime(stream: ZoneStream, bands: HrBand[], into: ZoneTotals = emptyZoneTotals()): ZoneTotals {
  const { timeS, distanceM, heartrate } = stream;
  const n = Math.min(timeS.length, distanceM.length, heartrate.length);
  for (let i = 1; i < n; i++) {
    const dt = timeS[i]! - timeS[i - 1]!;
    if (!(dt > 0) || dt > MAX_SAMPLE_GAP_S) continue;
    const hr = heartrate[i]!;
    if (!Number.isFinite(hr) || hr <= 0) continue;
    const dd = distanceM[i]! - distanceM[i - 1]!;
    const slice = into[bandForHr(hr, bands)];
    slice.seconds += dt;
    slice.meters += Number.isFinite(dd) && dd > 0 ? dd : 0;
  }
  return into;
}

export function totalSeconds(t: ZoneTotals): number {
  return t.recovery.seconds + t.easy.seconds + t.moderate.seconds + t.threshold.seconds;
}

/** Fraction of measured time in one band; 0 when nothing was measured. */
export function zoneShare(t: ZoneTotals, key: HrBandKey): number {
  const total = totalSeconds(t);
  return total > 0 ? t[key].seconds / total : 0;
}

/**
 * Observed pace (sec/km) while in a band, or null when too little was covered there to
 * be meaningful. Withheld rather than guessed — a pace from 40 metres of stream is noise.
 */
export const MIN_ZONE_METERS_FOR_PACE = 400;

export function zonePaceSecPerKm(t: ZoneTotals, key: HrBandKey): number | null {
  const { seconds, meters } = t[key];
  if (meters < MIN_ZONE_METERS_FOR_PACE || seconds <= 0) return null;
  return seconds / (meters / 1000);
}
