/**
 * Injury-risk readout from the Acute:Chronic Workload Ratio (ACWR) — the standard
 * sports-science proxy for training-load injury risk (Gabbett, BJSM 2016). The EWMA
 * variant (Williams et al. 2017) maps acute→ATL and chronic→CTL, which is exactly the
 * Banister state this app already computes, so no new load model is needed.
 *
 * Deliberately NOT a probability. Unlike a black-box model trained on other runners,
 * this returns an explainable band together with the ratio that produced it, so the
 * dashboard can say WHY ("1.6× your 4-week baseline"), not just "high".
 *
 * A returning runner's chronic base is near zero, which makes the raw ratio explode
 * (dividing by ~0) and cry wolf on the first easy week back. Below CHRONIC_FLOOR we
 * withhold the ratio and report "building base" instead — the same "don't show a number
 * the data can't support" stance as the prediction reliability gate.
 */

export type InjuryRiskLevel = "building_base" | "low" | "optimal" | "elevated" | "high";

/** Running CTL below this means the athlete is still returning; the ratio isn't meaningful. */
export const ACWR_CHRONIC_FLOOR = 5;
/** Gabbett "sweet spot": ratios in [0.8, 1.3] are the productive, low-risk build zone. */
export const ACWR_SWEET_MIN = 0.8;
export const ACWR_SWEET_MAX = 1.3;
/** Above this the literature reports a marked rise in injury incidence. */
export const ACWR_HIGH = 1.5;

export interface InjuryRiskInput {
  /** Running acute load (ATL, ~7-day). */
  acuteLoad: number;
  /** Running chronic load (CTL, ~4-week baseline). */
  chronicLoad: number;
}

export interface InjuryRisk {
  level: InjuryRiskLevel;
  /** ACWR, or null when the chronic base is too low for it to be meaningful. */
  ratio: number | null;
  /** Short label for the tile value, e.g. "Optimal". */
  headline: string;
  /** One plain-language sentence explaining the band. */
  reason: string;
}

export function estimateInjuryRisk(x: InjuryRiskInput): InjuryRisk {
  if (!(x.chronicLoad > ACWR_CHRONIC_FLOOR)) {
    return {
      level: "building_base",
      ratio: null,
      headline: "Building base",
      reason:
        "Not enough running history yet to judge load spikes — the ramp guardrails keep each step gradual while the base rebuilds.",
    };
  }

  const ratio = x.acuteLoad / x.chronicLoad;

  if (ratio > ACWR_HIGH) {
    return {
      level: "high",
      ratio,
      headline: "High",
      reason: `This week's running load is ${ratio.toFixed(2)}× your 4-week baseline — into the spike zone where injury risk climbs. Ease off.`,
    };
  }
  if (ratio > ACWR_SWEET_MAX) {
    return {
      level: "elevated",
      ratio,
      headline: "Elevated",
      reason: `Running load is ${ratio.toFixed(2)}× your baseline — a step above the safe build range. Hold here rather than adding more.`,
    };
  }
  if (ratio < ACWR_SWEET_MIN) {
    return {
      level: "low",
      ratio,
      headline: "Low",
      reason: `Running load is ${ratio.toFixed(2)}× your baseline — comfortably below your fitness, with room to build gradually.`,
    };
  }
  return {
    level: "optimal",
    ratio,
    headline: "Optimal",
    reason: `Running load is ${ratio.toFixed(2)}× your baseline — right in the productive, low-risk build zone.`,
  };
}
