# NEXT_STEPS.md — resume here

Working notes for picking this back up. Not a permanent doc like PROJECT.md — delete
or rewrite freely once it's stale. Written 2026-07-16.

## 0. First thing: check the bulk export finished

I kicked off `npm run ingest:export -- /Users/juanvega/Downloads/export_30300800`
(1818 activities) in the background and it was still running when we stopped.

```
npm run profile
```

Confirms it landed. Expect roughly:
- ~1818 activities, spanning your full Strava history
- streams present for FIT (614) and GPX (293) files
- **no streams for TCX files (763 of them)** — our parser only handles `.fit`/`.gpx`
  today; TCX activities will show up as metadata-only (no GAP/Minetti possible for
  those runs until a TCX parser exists). That's a chunk of history, worth deciding
  on deliberately rather than silently ignoring — see "Open decision" below.
- 2 `.json` files unhandled too (probably manual entries, likely negligible)

If `npm run profile` errors or counts look wrong, check
`/tmp/ingest_output.log` for parse failures per activity.

## 1. Open decision: TCX support

763 of 1818 activities (42%) are TCX and currently ingest with metadata only, no
GPS/HR/altitude streams. Options, not yet decided:
- Write a TCX parser (same shape as `src/ingest/gpx.ts` / `fit.ts`) — ingestion is
  AI-OK per PROJECT.md §9, so this is fair game to build together.
- Accept the gap if TCX activities are mostly old/low-signal (check date range and
  sport types of TCX-only activities before deciding).

## 2. T0 — race inventory (still open, manual, blocking)

This is the task that decides whether S1 (MAE < 3%) is even measurable. Per
PROJECT.md §11 it's still unchecked.

```
cp races.template.csv races.csv    # if you haven't already
# edit races.csv by hand — one row per race with a RELIABLE official time
npm run races:import -- races.csv
npm run profile                    # check races: matched vs unmatched
```

`races.csv` is gitignored on purpose (personal data) — the template is what's
committed. Unmatched races (no corresponding Strava activity) are fine, just noted.

## 3. After T0: F1, the deterministic layer

Per PROJECT.md §9, this is the **AI-free zone** — hand-written, autocomplete off.
I (Claude) can critique it once it exists, not write it. Planned modules, in
`src/deterministic/`:
- Riegel (distance extrapolation)
- VDOT / Daniels
- GAP / Minetti (needs the streams from step 0/1 — this is why TCX coverage matters)
- Banister CTL/ATL/TSB with the stress-score fallback hierarchy (PROJECT.md §6)

## Loose ends / housekeeping (low priority)

- `~/.supabase_token`, `~/.supabase_db_password`, `~/.strava_secret` are sitting in
  your home dir from setup (used to avoid pasting secrets into chat). Fine to leave,
  fine to delete — nothing reads them anymore except `.env` which already has what
  it needs.
- Strava OAuth: refresh token is in `.env` (`STRAVA_REFRESH_TOKEN`). Re-run
  `npm run strava:sync` anytime to pull activities newer than what's in the DB.

## What's already done

- Supabase project `lets-run` (`sa-east-1`) created and migrated
- F0a bulk export ingestion (CSV/GPX/FIT parsers) — built, running as of this doc
- F0b Strava API incremental sync (OAuth + watermark sync) — built and verified live
- Data profile tool (`npm run profile`) — read-only coverage report
- Bug fixed: all-null stream channels (e.g. HR-only gym sessions) failed to insert;
  fixed by pinning Postgres array OIDs in `src/ingest/load.ts`
