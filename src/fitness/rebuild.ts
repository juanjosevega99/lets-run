import type { Sql } from "../db.js";
import { activityStress, isRunning, type AthleteHrProfile } from "../deterministic/stress.js";
import { banisterSeries, fillDays } from "../deterministic/banister.js";
import { vdotFromRace } from "../deterministic/vdot.js";
import { dateOnly, isoDate } from "../lib/time.js";
import type { Log } from "../strava/sync.js";

/**
 * Rebuilds the fitness_state table (PRD §4) from scratch: stress hierarchy per
 * activity → daily loads → Banister CTL/ATL/TSB series → bulk upsert. Idempotent;
 * re-run after every sync.
 *
 *   npm run fitness:rebuild
 *
 * Core is exported so the dashboard's refresh button runs the identical code path.
 * Does NOT close `sql` — the caller owns the connection.
 */
const MODEL_VERSION = "banister-v1";

export async function rebuildFitness(sql: Sql, log: Log): Promise<void> {
  {
    const activities = await sql<
      {
        sport_type: string;
        start_date: Date;
        moving_time_s: number | null;
        elapsed_time_s: number | null;
        distance_m: number | null;
        avg_hr: number | null;
        max_hr: number | null;
      }[]
    >`select sport_type, start_date, moving_time_s, elapsed_time_s, distance_m, avg_hr, max_hr
      from activities order by start_date`;
    if (activities.length === 0) {
      log("no activities — ingest first");
      return;
    }

    const races = await sql<{ distance_m: number; official_time_s: number }[]>`
      select distance_m, official_time_s from races`;
    const refVdot =
      races.length > 0
        ? Math.max(...races.map((r) => vdotFromRace(r.distance_m, r.official_time_s)))
        : 45;

    const observedMax = Math.max(0, ...activities.map((a) => a.max_hr ?? 0));
    const hr: AthleteHrProfile = {
      hrMax: observedMax >= 170 && observedMax <= 210 ? observedMax : 193,
      hrRest: Number(process.env.ATHLETE_HR_REST ?? 55),
    };

    const byDay = new Map<string, { runningStress: number; totalStress: number }>();
    const methods = { trimp: 0, pace: 0, flat: 0 };
    for (const a of activities) {
      const s = activityStress(
        {
          sportType: a.sport_type,
          movingTimeS: a.moving_time_s,
          elapsedTimeS: a.elapsed_time_s,
          distanceM: a.distance_m,
          avgHr: a.avg_hr,
        },
        hr,
        refVdot,
      );
      methods[s.method]++;
      const day = dateOnly(a.start_date);
      const cur = byDay.get(day) ?? { runningStress: 0, totalStress: 0 };
      cur.totalStress += s.stress;
      if (isRunning(a.sport_type)) cur.runningStress += s.stress;
      byDay.set(day, cur);
    }

    const series = banisterSeries(
      fillDays(byDay, dateOnly(activities[0]!.start_date), isoDate(new Date())),
    );

    for (let i = 0; i < series.length; i += 500) {
      const chunk = series.slice(i, i + 500).map((d) => ({
        day: d.day,
        ctl: d.ctl,
        atl: d.atl,
        tsb: d.tsb,
        model_version: MODEL_VERSION,
      }));
      await sql`
        insert into fitness_state ${sql(chunk)}
        on conflict (day) do update set
          ctl = excluded.ctl, atl = excluded.atl, tsb = excluded.tsb,
          model_version = excluded.model_version, computed_at = now()
      `;
    }

    const today = series.at(-1)!;
    log(`fitness rebuilt: ${series.length} days (${MODEL_VERSION})`);
    log(`stress methods: trimp ${methods.trimp} · pace ${methods.pace} · flat ${methods.flat}`);
    log(
      `today: CTL ${today.ctl.toFixed(1)} (running fitness) · ATL ${today.atl.toFixed(1)} (fatigue) · TSB ${today.tsb.toFixed(1)} (form)`,
    );
  }
}

