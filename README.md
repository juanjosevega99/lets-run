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

## Development

- `npm test` — unit tests
- `npm run typecheck`
- `src/deterministic/` is the hand-written AI-free zone (PROJECT.md §9).
