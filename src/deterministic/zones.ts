/**
 * Heart-rate training zones. Source: Daniels' Running Formula — the Easy/aerobic
 * zone is 65–79% of maximum heart rate; threshold sits around 88–92% HRmax.
 *
 * Why this module exists: pace prescriptions derived from a peak-fitness VDOT are
 * wrong for a detrained athlete (the same pace costs far more effort). Heart rate is
 * self-normalizing — 74% of max is easy whether you're peak-fit or rebuilding — so
 * easy sessions are prescribed by HR ceiling, with pace as a secondary reference.
 */

export interface HrProfile {
  hrMax: number;
  hrRest: number;
}

export interface HrZones {
  /** Bottom of the easy/aerobic band (65% HRmax). */
  easyFloor: number;
  /** Top of the easy/aerobic band (79% HRmax) — do not exceed on an easy run. */
  easyCeiling: number;
  /** Approximate threshold HR (88% HRmax). */
  threshold: number;
}

export const EASY_FLOOR_PCT = 0.65;
export const EASY_CEILING_PCT = 0.79;
export const THRESHOLD_PCT = 0.88;

export function hrZones(p: HrProfile): HrZones {
  return {
    easyFloor: Math.round(p.hrMax * EASY_FLOOR_PCT),
    easyCeiling: Math.round(p.hrMax * EASY_CEILING_PCT),
    threshold: Math.round(p.hrMax * THRESHOLD_PCT),
  };
}

/** Fallback when no plausible max has ever been observed. */
export const DEFAULT_HR_MAX = 193;
export const HR_MAX_MIN = 170;
export const HR_MAX_MAX = 210;

/**
 * The athlete's working max HR from the highest value ever recorded, rejecting
 * implausible sensor spikes rather than letting one bad sample define the zones.
 *
 * Single source of truth: the load model (`fitness/rebuild`) and the prescription
 * (`plan/context`) must agree, or the zones used to SCORE training drift away from
 * the zones used to PRESCRIBE it (red-team L1).
 */
export function resolveHrMax(observedMax: number | null | undefined): number {
  if (observedMax == null) return DEFAULT_HR_MAX;
  return observedMax >= HR_MAX_MIN && observedMax <= HR_MAX_MAX ? observedMax : DEFAULT_HR_MAX;
}

/** Ordered intensity bands, low → high. `max` is exclusive; the top band is open-ended. */
export type HrBandKey = "recovery" | "easy" | "moderate" | "threshold";

export interface HrBand {
  key: HrBandKey;
  label: string;
  /** What the band is FOR — shown to the athlete, so it must be plain language. */
  purpose: string;
  min: number;
  /** null on the open-ended top band. */
  max: number | null;
}

/**
 * The zone ladder the dashboard shows. Derived from the same percentages the planner
 * already prescribes against, so the displayed zones can never disagree with the
 * session HR ceilings.
 */
export function hrBands(p: HrProfile): HrBand[] {
  const z = hrZones(p);
  return [
    {
      key: "recovery",
      label: "Recovery",
      purpose: "Warm-up and walk breaks only",
      min: 0,
      max: z.easyFloor,
    },
    {
      key: "easy",
      label: "Easy",
      purpose: "Where aerobic base is built. Full-sentence talk test.",
      min: z.easyFloor,
      max: z.easyCeiling,
    },
    {
      key: "moderate",
      label: "Moderate",
      purpose: "The grey zone — tiring, but not where base comes from",
      min: z.easyCeiling,
      max: z.threshold,
    },
    {
      key: "threshold",
      label: "Threshold and above",
      purpose: "Comfortably hard and above; earn it after the return phase",
      min: z.threshold,
      max: null,
    },
  ];
}

/** Which band a heart rate falls in. */
export function bandForHr(hr: number, bands: HrBand[]): HrBandKey {
  for (const b of bands) {
    if (b.max == null || hr < b.max) return b.key;
  }
  return "threshold";
}

/**
 * Share of easy running is the single most actionable number for a returning athlete:
 * base is built below the easy ceiling, and the classic polarized split puts ~80% of
 * time there. Anything less means the "grey zone" is eating the aerobic work.
 */
export const EASY_SHARE_TARGET = 0.8;

/**
 * Median of a numeric list. Used for observed-pace estimation, where a median is
 * the right choice over a mean — one mis-recorded GPS run shouldn't move the
 * prescribed easy pace.
 */
export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
