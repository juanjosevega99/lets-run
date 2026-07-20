import type { Sql } from "../db.js";
import { activityStress, isAerobic, isRunning, type AthleteHrProfile } from "../deterministic/stress.js";
import { banisterSeries, fillDays } from "../deterministic/banister.js";
import { vdotFromRace } from "../deterministic/vdot.js";
import { dateInTimeZone } from "../lib/time.js";
import { dashboardTz } from "../web/queries.js";
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
const MODEL_VERSION = "banister-v2-multisport";

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

    const byDay = new Map<string, { runningStress: number; aerobicStress: number; totalStress: number }>();
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
      // Fitness and weekly compliance must use the same local-day boundary. In
      // Colombia, an evening workout is already the next UTC date.
      const day = dateInTimeZone(a.start_date, dashboardTz());
      const cur = byDay.get(day) ?? { runningStress: 0, aerobicStress: 0, totalStress: 0 };
      cur.totalStress += s.stress;
      if (isRunning(a.sport_type)) cur.runningStress += s.stress;
      if (isAerobic(a.sport_type)) cur.aerobicStress += s.stress;
      byDay.set(day, cur);
    }

    const series = banisterSeries(
      fillDays(
        byDay,
        dateInTimeZone(activities[0]!.start_date, dashboardTz()),
        dateInTimeZone(new Date(), dashboardTz()),
      ),
    );

    for (let i = 0; i < series.length; i += 500) {
      const chunk = series.slice(i, i + 500).map((d) => ({
        day: d.day,
        ctl: d.ctl,
        atl: d.atl,
        tsb: d.tsb,
        aerobic_ctl: d.aerobicCtl,
        aerobic_atl: d.aerobicAtl,
        total_ctl: d.totalCtl,
        total_atl: d.totalAtl,
        total_tsb: d.totalTsb,
        running_load: d.runningLoad,
        aerobic_load: d.aerobicLoad,
        total_load: d.totalLoad,
        model_version: MODEL_VERSION,
      }));
      await sql`
        insert into fitness_state ${sql(chunk)}
        on conflict (day) do update set
          ctl = excluded.ctl, atl = excluded.atl, tsb = excluded.tsb,
          aerobic_ctl = excluded.aerobic_ctl, aerobic_atl = excluded.aerobic_atl,
          total_ctl = excluded.total_ctl, total_atl = excluded.total_atl,
          total_tsb = excluded.total_tsb, running_load = excluded.running_load,
          aerobic_load = excluded.aerobic_load, total_load = excluded.total_load,
          model_version = excluded.model_version, computed_at = now()
      `;
    }

    const today = series.at(-1)!;
    log(`fitness rebuilt: ${series.length} days (${MODEL_VERSION})`);
    log(`stress methods: trimp ${methods.trimp} · pace ${methods.pace} · flat ${methods.flat}`);
    log(
      `today: run CTL ${today.ctl.toFixed(1)} · run ATL ${today.atl.toFixed(1)} · run TSB ${today.tsb.toFixed(1)}`,
    );
    log(
      `cross-training context: aerobic CTL ${today.aerobicCtl.toFixed(1)} · total load balance ${today.totalTsb.toFixed(1)}`,
    );
  }
}
