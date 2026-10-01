import type { Sql } from "../db.js";
import { hrBands, resolveHrMax, type HrProfile } from "../deterministic/zones.js";
import {
  classifyFromAverage,
  classifyRunIntensity,
  type RunIntensityResult,
} from "../deterministic/runIntensity.js";

/** The athlete's HR profile, resolved exactly as the planner resolves it. */
export async function loadHrProfile(sql: Sql): Promise<HrProfile | null> {
  const rows = await sql<{ hr_max: number | null }[]>`
    select max(max_hr) as hr_max from activities where max_hr is not null`;
  const observed = rows[0]?.hr_max;
  if (observed == null) return null;
  return { hrMax: resolveHrMax(Number(observed)), hrRest: Number(process.env.ATHLETE_HR_REST ?? 55) };
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
