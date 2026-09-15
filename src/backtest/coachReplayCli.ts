import "dotenv/config";
import { connect } from "../db.js";
import { dashboardTz } from "../web/queries.js";
import { RACE } from "../lib/race.js";
import { formatCoachReplay, replayCoach, type ReplayActivity, type ReplayFitness } from "./coachReplay.js";

/**
 * Replays the coach across the athlete's whole training history.
 *
 *   npm run backtest:coach              # every week
 *   npm run backtest:coach -- --problems  # only weeks with a violation
 *
 * Two queries, then pure simulation — see coachReplay.ts for why.
 */
async function main() {
  const onlyProblems = process.argv.slice(2).includes("--problems");
  const sql = connect();
  try {
    const tz = dashboardTz();
    const activities = await sql<ReplayActivity[]>`
      select (start_date at time zone ${tz})::date::text as date,
             (extract(isodow from start_date at time zone ${tz})::int - 1) as weekday,
             case when sport_type ilike '%run%' then 'run'
                  when sport_type ilike '%weight%' or sport_type ilike '%strength%' then 'strength'
                  else 'other' end as sport,
             coalesce(distance_m, 0) / 1000.0 as km,
             coalesce(case when moving_time_s > 0 then moving_time_s else elapsed_time_s end, 0) / 60.0 as minutes
      from activities
      order by start_date
    `;
    const fitness = await sql<ReplayFitness[]>`
      select day::text as date,
             coalesce(tsb, 0) as tsb,
             case when aerobic_ctl is not null and aerobic_atl is not null
                  then aerobic_ctl - aerobic_atl end as "aerobicTsb",
             total_tsb as "totalTsb"
      from fitness_state order by day
    `;
    if (activities.length === 0) {
      console.log("coach replay: no activities — run the ingest first.");
      return;
    }
    const result = replayCoach(activities, fitness, {
      raceDateIso: RACE.dateIso,
      lowerBodyStrengthDays: (process.env.ATHLETE_LOWER_BODY_DAYS ?? "")
        .split(",")
        .map(Number)
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
    });
    console.log(formatCoachReplay(result, onlyProblems));
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
