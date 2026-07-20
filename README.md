# lets-run

Adaptive race-specific run + strength coach for one user. Read [PROJECT.md](PROJECT.md) first — if a change
isn't justified there, it doesn't get built.

## Setup

1. Create a Supabase project, copy the connection string into `.env` (see `.env.example`).
2. `npm install`
3. `npm run migrate`

## Backfill (F0a)

1. Strava → Settings → My Account → *Download or Delete Your Account* → request your
   archive ("Download Request"). Takes a few hours; arrives by email.
2. Unzip it somewhere outside the repo (or into `data/`, which is gitignored).
3. `npm run ingest:export -- /path/to/export`

Re-running is safe — everything upserts.

## Race inventory (T0)

The backtest set is entered by hand — official race times are the ground truth and no API
gives them reliably.

1. Copy the template: `cp races.template.csv races.csv` (`races.csv` is gitignored).
2. Fill one row per race you have a reliable official time for. Human-friendly units:
   distance in km, time as `H:MM:SS` or `MM:SS`. Comment lines start with `#`.
3. `npm run races:import -- races.csv`

Idempotent on (name, date) — edit the CSV and re-import to update in place. Bad rows fail
loudly with the line number rather than silently shrinking the set.

## Backtest (F2)

```
npm run backtest
```

Runs every predictor registered in `src/backtest/registry.ts` against the race set,
feeding each one only pre-race data, and reports per-race error + MAE against the S1
target (< 3%). Every prediction is persisted to `prediction_log` with its data cutoff.
The registry is empty until the hand-written deterministic layer (F1) exists — the
harness will tell you exactly that.

## Dashboard

```
npm run web        # http://localhost:3000
```

Three screens (PRD F-C, functional-not-polished): **Now** (countdown, truthful
current-shape estimate, multi-sport load, last-28-days training), **Plan week**
(prescription and actuals aligned to the same dates), **Trajectory** (weekly volume and
current-shape estimates over time). The dashboard refresh runs Strava sync → multi-sport
fitness rebuild → current-shape estimate → completed-week review → next plan.

Coach v2 separates running-specific, combined-aerobic, and whole-program load. It uses
the race clock only after readiness gates: a long gap selects a three-day, duration-first
return-to-run week before base/build/specific/taper work. Recurring gym days are inferred;
configure `ATHLETE_LOWER_BODY_DAYS` in `.env` because Strava's generic strength records
cannot reveal the split.

`DASHBOARD_TZ` (default `America/Bogota`) controls activity-day, fitness,
plan-week, and compliance bucketing.

## Vercel release and phone access

The app can run as a Vercel Node function, with Supabase Postgres holding all durable
training data. After the one-time setup below, the laptop is not needed to view the
dashboard: open the project's `*.vercel.app` URL on your phone and save it to the home
screen. The Basic Auth prompt is the dashboard password.

1. Import the repository into Vercel and link it to the project (`VERCEL_ORG_ID` and
   `VERCEL_PROJECT_ID` are available from the Vercel CLI/project settings).
2. Run `npm run migrate` once with the production `DATABASE_URL` before the first deploy.
3. In Vercel → Project Settings → Environment Variables, add `DATABASE_URL`,
   the Strava variables, athlete profile variables, and `DASHBOARD_TZ` for **Production**.
   Preview deployments should use a separate database
   (or be disabled) so a pull request cannot write to production training data.
4. Add these GitHub repository secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and
   `VERCEL_PROJECT_ID`.

The workflows in `.github/workflows/` run typechecks/tests and deploy pull requests as
previews. A push to `main` creates the production deployment. Vercel's Git integration
can also deploy automatically if you prefer to omit the release workflow. The refresh
endpoint is protected, POST-only, and has a 60-second function limit; a long Strava sync
may later be better moved to a background job.

## Development

- `npm test` — unit tests
- `npm run typecheck`
- `src/deterministic/` is the hand-written AI-free zone (PROJECT.md §9). The backtest
  harness and dashboard are built around that hole on purpose: write a predictor,
  register it, and both light up.
