# lets-run

Race predictor / coach for one user. Read [PROJECT.md](PROJECT.md) first — if a change
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

Three screens (PRD F-C, functional-not-polished): **Now** (countdown, bracket target,
prediction w/ gap-to-target, last-28-days raw training), **This week** (logged vs
planned), **Trajectory** (weekly volume vs the 2021-22 peak average, predictions over
time). Set `DASHBOARD_PASSWORD` to enable the single-user auth gate — required before
deploying anywhere public. `DASHBOARD_TZ` (default `America/Bogota`) controls week
bucketing.

## Development

- `npm test` — unit tests
- `npm run typecheck`
- `src/deterministic/` is the hand-written AI-free zone (PROJECT.md §9). The backtest
  harness and dashboard are built around that hole on purpose: write a predictor,
  register it, and both light up.
