import type { Sql } from "../db.js";
import { hrBands, hrZones, resolveHrMax, type HrProfile } from "../deterministic/zones.js";
import {
  estimateThreshold,
  findSteadyEffort,
  STEADY_WINDOW_S,
  type SteadyEffort,
  type ThresholdEstimate,
} from "../deterministic/thresholdEvidence.js";
import {
  classifyFromAverage,
  classifyRunIntensity,
  type RunIntensityResult,
} from "../deterministic/runIntensity.js";

/** How far back sustained efforts count as evidence about current threshold. */
export const THRESHOLD_EVIDENCE_DAYS = 56;

/**
 * Threshold from sustained-effort evidence, for an already-resolved max HR.
 *
 * Only runs that could possibly contain a 20-minute effort above the easy ceiling are
 * fetched — long enough, with a max HR above it — so this stays cheap enough to run on
 * a page load rather than needing its own table.
 */
export async function loadThresholdEstimate(sql: Sql, hrMax: number): Promise<ThresholdEstimate> {
  const easyCeiling = hrZones({ hrMax, hrRest: 0 }).easyCeiling;
  const rows = await sql<
    {
      id: string | number;
      date: string;
      time_s: number[] | null;
      distance_m: number[] | null;
      heartrate: (number | null)[] | null;
      altitude_m: (number | null)[] | null;
    }[]
  >`
    select a.id, a.start_date::date::text as date, s.time_s, s.distance_m, s.heartrate, s.altitude_m
    from activities a join activity_streams s on s.activity_id = a.id
    where a.sport_type ilike '%run%'
      and a.start_date >= now() - make_interval(days => ${THRESHOLD_EVIDENCE_DAYS})
      and a.moving_time_s >= ${STEADY_WINDOW_S}
      and a.max_hr > ${easyCeiling}
  `;
  const efforts: SteadyEffort[] = [];
  for (const r of rows) {
    if (!r.time_s || !r.distance_m || !r.heartrate) continue;
    const effort = findSteadyEffort(
      { timeS: r.time_s, distanceM: r.distance_m, heartrate: r.heartrate },
      easyCeiling,
    );
    if (effort) {
      efforts.push({
        ...effort,
        activityId: Number(r.id),
        date: r.date,
        netElevationM: netElevation(r.altitude_m, effort.startIndex, effort.endIndex),
      });
    }
  }
  return estimateThreshold(hrMax, efforts);
}

/**
 * Net climb (+) or descent (−) across a window, from a 5-sample median at each end so
 * one noisy altitude sample cannot manufacture a slope. Undefined without altitude.
 */
function netElevation(
  altitude: (number | null)[] | null,
  start: number | undefined,
  end: number | undefined,
): number | undefined {
  if (!altitude || start == null || end == null) return undefined;
  const around = (i: number) => {
    const xs = altitude
      .slice(Math.max(0, i - 2), i + 3)
      .filter((v): v is number => v != null && Number.isFinite(v))
      .sort((a, b) => a - b);
    return xs.length > 0 ? xs[Math.floor(xs.length / 2)]! : null;
  };
  const a = around(start);
  const b = around(end);
  return a == null || b == null ? undefined : b - a;
}

/**
 * The athlete's HR profile — the ONE place it is built. The planner, the weekly review,
 * the intensity labels and the zones page all used to resolve it separately, so a
 * measured threshold could not have reached them all; now it does by construction.
 */
export async function loadHrProfile(sql: Sql): Promise<HrProfile | null> {
  const rows = await sql<{ hr_max: number | null }[]>`
    select max(max_hr) as hr_max from activities where max_hr is not null`;
  const observed = rows[0]?.hr_max;
  if (observed == null) return null;
  const hrMax = resolveHrMax(Number(observed));
  const threshold = await loadThresholdEstimate(sql, hrMax);
  return {
    hrMax,
    hrRest: Number(process.env.ATHLETE_HR_REST ?? 55),
    // Only a MEASURED threshold is passed on; otherwise hrZones applies the same
    // percentage rule it always has, so nothing changes until evidence exists.
    ...(threshold.source === "measured" ? { thresholdHr: threshold.thresholdHr } : {}),
  };
}

/**
 * What each run actually was, keyed by activity id. One query for the streams, then
 * pure classification. Runs with no usable stream fall back to average HR and say so.
 */
export async function loadRunIntensities(
  sql: Sql,
  activityIds: number[],
  profile?: HrProfile | null,
): Promise<Map<number, RunIntensityResult>> {
  const out = new Map<number, RunIntensityResult>();
  if (activityIds.length === 0) return out;
  const hr = profile === undefined ? await loadHrProfile(sql) : profile;
  if (hr == null) return out;
  const bands = hrBands(hr);

  const rows = await sql<
    {
      id: string | number;
      avg_hr: number | null;
      time_s: number[] | null;
      distance_m: number[] | null;
      heartrate: (number | null)[] | null;
    }[]
  >`
    select a.id, a.avg_hr, s.time_s, s.distance_m, s.heartrate
    from activities a left join activity_streams s on s.activity_id = a.id
    where a.id = any(${activityIds})
  `;
  for (const r of rows) {
    const id = Number(r.id);
    const usable =
      r.time_s && r.heartrate && r.distance_m &&
      r.time_s.length > 1 && r.heartrate.length === r.time_s.length && r.distance_m.length === r.time_s.length;
    const fromStream = usable
      ? classifyRunIntensity(
          { timeS: r.time_s!, distanceM: r.distance_m!, heartrate: r.heartrate!.map((h) => h ?? 0) },
          bands,
        )
      : null;
    out.set(
      id,
      fromStream && fromStream.label !== "unknown" ? fromStream : classifyFromAverage(r.avg_hr, hr),
    );
  }
  return out;
}
