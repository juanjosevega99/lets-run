# P0 implementation spec — the post-session check-in feedback loop

> **Audience:** an implementing agent/model with NO prior context on this conversation.
> Everything needed is in this file plus the repo. Written 2026-07-19 against commit
> `a2d5d68` + uncommitted working-tree changes (7 modified files — do not revert them).
>
> **Definition of done** is §7. Do not stop at "code written" — the runbook in §8 must
> pass, including the live browser check.

---

## 1. Why this is the highest-priority gap (evidence, not opinion)

Coach v2's weekly controller is **structurally capped**. Trace the loop:

- `src/deterministic/weekTemplate.ts` → `runningProgressionFactor()`: weekly running
  volume grows (×1.05) **only** on a previous-week decision of `PROGRESS`, and deloads
  (×0.8) **only** on `DELOAD`. `REPEAT`/`PROCEED`/`null` → ×1.0.
- `src/plan/review.ts` → `reviewWeek()`: emits `PROGRESS` **only** when
  `readinessConfirmed === true`, and `DELOAD` **only** when `redFlag === true`
  (see the decision ladder around line 82).
- `src/plan/review.ts` → `reviewLatestCompletedWeek()` (the only production caller)
  **never sets either field** — the `WeekReviewInput` doc comment says they are
  "reserved… once the check-in UI lands", and the persisted `decision_inputs` hardcodes
  `readiness_confirmed: false` (around line 197).

Consequence: in production the system can only ever emit `REPEAT` or `PROCEED`.
**Volume can never grow, and pain can never trigger a deload.** Both halves of the
adaptive loop dead-end on the missing check-in. `NEXT_STEPS.md` §"P0 — close the real
feedback loop" names this the top product gap; its guardrail sentence is the design's
north star: *"Missing feedback must never be treated as a green recovery signal."*

## 2. What already exists (do NOT recreate; read before coding)

| Artifact | State |
|---|---|
| `migrations/005_session_feedback.sql` | **Done, not yet applied.** `session_feedback` table keyed by `activity_id` (Strava IDs are stable — no new ID infrastructure). Enums as CHECK constraints; see file. |
| `src/plan/feedback.ts` | **Done, tested-shape but has no tests yet.** Exports: enums (`PAIN_LEVELS`, `SORENESS_LEVELS`, `GYM_FOCUS`, `GYM_DIFFICULTY`), `SessionFeedback`, `ReadinessSignal`, `deriveReadiness()` (the policy), `parseFeedbackForm()` (urlencoded → validated `SessionFeedback` or string error). |
| `src/plan/review.ts` | Pure `reviewWeek()` already handles `redFlag`/`readinessConfirmed` and is covered by `src/plan/review.test.ts` (8 cases incl. both fields). Only the DB wrapper `reviewLatestCompletedWeek()` needs changes. |
| Review scheduling | Already correct: `reviewLatestCompletedWeek(sql, reviewCutoffForReplan(), log)` runs at the top of both plan paths (`src/plan/freePlan.ts:17`, `src/plan/cli.ts:21`). `reviewCutoffForReplan()` (in `src/plan/context.ts`) allows Sunday-evening review of the finishing week. No changes needed. |
| Decision consumption | `latestWeekDecision()` → `buildPlanContext()` → `runningProgressionFactor()`. Already wired. No changes needed. |

### The locked policy (implemented in `deriveReadiness`, mirror it in UI copy)

| Signal | Rule |
|---|---|
| `redFlag` (→ DELOAD) | ANY check-in that week (any sport — a painful gym session counts) with `pain_during = 'significant'` OR `morning_soreness = 'unusual'` |
| `readinessConfirmed` (→ allows PROGRESS) | EVERY run of the reviewed week has a check-in, all with `pain_during = 'none'` AND `morning_soreness ∈ {'none','normal'}` |
| Mild pain / missing reports | Blocks `readinessConfirmed` **without** raising `redFlag` → decision lands on PROCEED (completion counts, progression doesn't) |

## 3. Remaining work — file by file

### 3.1 `src/web/queries.ts`

1. Add `id: number` as the **first field** of `LoggedActivity`, and select/map `a.id`
   in **both** `thisWeekActivities()` and `activitiesForWeek()`.
   ⚠️ This breaks test fixtures in `src/web/pages/pages.test.ts` that build
   `activities: [...]` objects — add an `id` to each (§5).
2. New query for the check-in UI (place near `activitiesForWeek`):

```ts
export interface CheckinActivity extends LoggedActivity {
  feedback: SessionFeedback | null; // import type from ../plan/feedback.js
}

/** Last-N-days activities with any existing check-in, newest first. 10 days keeps
 *  last week's runs reachable during a Monday replan. */
export async function checkinActivities(sql: Sql, days: number): Promise<CheckinActivity[]>
```

Left-join `session_feedback f on f.activity_id = a.id`, window
`a.start_date >= now() - make_interval(days => ${days})`, order `start_date desc`.
Map DB snake_case → `SessionFeedback` camelCase; `feedback: null` when no row
(join test: `f.activity_id is null`).

### 3.2 `src/plan/review.ts` — make `reviewLatestCompletedWeek()` truthful

Current per-day aggregation query (~line 153) groups activities by ISO day. Replace
with **per-activity** rows so IDs survive:

```sql
select a.id,
       (extract(isodow from a.start_date at time zone ${tz})::int - 1) as day,
       coalesce(a.distance_m, 0) / 1000.0 as distance_km,
       coalesce(case when a.moving_time_s > 0 then a.moving_time_s else a.elapsed_time_s end, 0) / 60.0 as duration_minutes,
       a.sport_type
from activities a
where (a.start_date at time zone ${tz}) >= ${weekStart}::date
  and (a.start_date at time zone ${tz}) < (${weekStart}::date + interval '7 days')
```

Then:
1. Runs = rows with `sport_type ilike '%run%'`. Re-aggregate runs **per day** in TS
   (sum km and minutes) before calling `reviewWeek` — two short runs on one day must
   still combine, preserving current matching behavior exactly.
2. Fetch that week's feedback for ALL the week's activity ids (one `where activity_id = any(...)` query on `session_feedback`), map to `SessionFeedback`.
3. `const readiness = deriveReadiness(runIds, weekFeedback)`.
4. Pass `redFlag: readiness.redFlag, readinessConfirmed: readiness.readinessConfirmed`
   into `reviewWeek({...})`.
5. Persist truthfully in `decision_inputs` (replace the hardcoded
   `readiness_confirmed: false`):

```ts
readiness_confirmed: readiness.readinessConfirmed,
red_flag: readiness.redFlag,
readiness_reasons: readiness.reasons,
runs_checked_in: readiness.runsCheckedIn,
runs_total: readiness.runsTotal,
```

Keep the function a no-op when no unreviewed completed week exists (already the case).

### 3.3 `src/web/server.ts` — `POST /actions/checkin`

Add alongside `/actions/refresh` (same placement, after auth, using the same
`path` variable — **not** `req.url`, because Vercel rewrites deliver the public route
via `?path=...`; see lines 65-68).

- `POST` only → 405 otherwise (mirror the refresh endpoint).
- Read the body with a small helper (new, in server.ts): reject bodies > 32 KB
  (413), collect chunks, `new URLSearchParams(body)`.
- `parseFeedbackForm(params)` → on string error: 400 text response with the error.
- Upsert:

```sql
insert into session_feedback (activity_id, rpe, pain_during, morning_soreness,
                              gym_focus, lower_body_difficulty, notes)
values (...)
on conflict (activity_id) do update set
  rpe = excluded.rpe, pain_during = excluded.pain_during,
  morning_soreness = excluded.morning_soreness, gym_focus = excluded.gym_focus,
  lower_body_difficulty = excluded.lower_body_difficulty, notes = excluded.notes,
  updated_at = now()
```

- Catch Postgres FK violation (`(err as { code?: string }).code === "23503"`) →
  400 "unknown activity". Other errors → 500.
- Success → **303 redirect** to `/week` (PRG pattern; the dashboard is server-rendered,
  no fetch/JS needed for this flow).

### 3.4 `src/web/pages/week.ts` — the check-in UI

- `WeekData` gains `checkin: CheckinActivity[]` (required).
- New section between "Daily schedule" and "Logged": eyebrow "Check-in", heading
  "How did it feel?", copy stating the policy honestly (e.g. *"Progression is only
  unlocked by pain-free check-ins; missing feedback holds the plan steady, and pain
  reports trigger a deload."*).
- One `<form method="post" action="/actions/checkin">` per activity in
  `d.checkin`, prefilled from `feedback` when present:
  - hidden `activity_id`;
  - `rpe`: `<select>` blank + 1–10;
  - `pain_during`: select with the four `PAIN_LEVELS` (labels: "Not reported",
    "No pain", "Mild pain", "Significant pain");
  - `morning_soreness`: four `SORENESS_LEVELS` ("Not reported", "None", "Normal
    post-training", "Unusual soreness");
  - strength sessions only (`/weight|strength|workout/i.test(sportType)`): add
    `gym_focus` ("Upper", "Lower", "Full body") and `lower_body_difficulty`
    ("Easy", "Moderate", "Hard");
  - submit button ("Save check-in" / "Update check-in" when prefilled).
- Checked-in activities show a compact one-line summary (e.g.
  `RPE 6 · no pain · normal soreness`) above their (still editable) form — wrap the
  form in `<details>` for checked-in rows, open form for missing ones.
- Escape all DB-sourced text with `esc()` (`../html.js`). Match the existing design
  system: `.panel`, `.eyebrow`, `.pill`, `.section-block`, `.logged-row` grid.
- ⚠️ Match the house style in `src/web/pages/*.ts`: sentence-case copy, no raw
  `aerobic_base`-style tokens in user-facing text (tests assert this).

### 3.5 `src/web/layout.ts` — CSS

Small additions using existing custom properties (`--line`, `--surface`,
`--muted-strong`, `--radius`): `.checkin-row` grid, selects styled like the design
(`font: inherit`, padding, `border: 1px solid var(--line)`, radius), summary line
style. Follow the existing responsive breakpoint pattern (~line 265) for mobile.

### 3.6 `src/web/server.ts` route `/week`

Fetch `checkinActivities(sql, 10)` in the `Promise.all` and pass as `checkin`.

## 4. Tests to add (vitest; run with `npm test`)

**New `src/plan/feedback.test.ts`:**
- `deriveReadiness`: all-clear → `readinessConfirmed` true, no red flag;
  missing check-in on one of N runs → not confirmed, reason mentions missing;
  mild pain → not confirmed, no red flag; significant pain on a **gym** session →
  red flag even with pain-free runs; unusual morning soreness → red flag;
  zero runs → not confirmed ("no runs to confirm"); `not_reported` soreness → not
  confirmed. Assert `runsCheckedIn`/`runsTotal` counts.
- `parseFeedbackForm`: happy path (all fields), minimal path (only activity_id →
  `not_reported` defaults, null rpe), rejects: bad id, rpe 0/11/2.5, unknown enum
  values, >2000-char notes. Whitespace-only notes → null.

**Extend `src/web/pages/pages.test.ts`:**
- renderWeek with a `checkin` array: run form renders rpe/pain/soreness selects and
  hidden activity_id; strength activity also renders gym_focus + difficulty; existing
  feedback renders the summary line and prefills (assert `selected` on the right
  option); no `npm run` strings (existing convention).
- Fixtures: add `id` to every `LoggedActivity` literal and `checkin: []` to every
  existing `renderWeek(...)` call.

**Update `src/plan/review.test.ts`:** nothing — pure paths already covered. Add cases
only if `reviewLatestCompletedWeek` refactoring extracts new pure helpers.

## 5. Known breakages to expect while implementing

- Adding required `id` to `LoggedActivity` → `pages.test.ts` fixtures fail typecheck
  until updated (§4).
- Adding required `checkin` to `WeekData` → same fixtures + `/week` route call site.
- `npm run typecheck` must pass with **zero** errors before running tests
  (`build` script is `typecheck`; Vercel deploy runs it).

## 6. Environment / infra notes

- DB is Supabase; `npm run migrate` applies `migrations/*.sql` in order and records
  them in `schema_migrations`. Apply 005 before e2e.
- Postgres `DATE` columns come back from postgres.js as midnight-UTC `Date` objects —
  **never** `String(...)` them; use `dateOnly()` from `src/lib/time.ts` (this bug has
  bitten this repo before; see the helper's doc comment).
- Timezone: all week bucketing uses `dashboardTz()` (default `America/Bogota`).
- The dashboard may run on Vercel (`api/index.ts` wraps `requestHandler`); routes are
  delivered as `?path=/week` there. Endpoint code must use the resolved `path`
  variable, and redirects should target the public path (`/week`).
- Auth: global basic-auth gate when `DASHBOARD_PASSWORD` is set; endpoints inherit it.

## 7. Definition of done

1. `npm run typecheck` clean; `npm test` fully green (301 existing + new).
2. Migration 005 applied to Supabase.
3. Browser: `/week` shows the check-in section; submitting a check-in for a real
   activity persists (verify row in `session_feedback`) and redirects back with the
   summary visible; resubmitting updates in place.
4. Simulated review honesty check: with a past `plan_week` + a run + feedback in a
   test (or against a scratch week), `reviewLatestCompletedWeek` writes
   `decision_inputs.readiness_confirmed = true` for a pain-free fully-checked-in week,
   `decision = 'DELOAD'` when a significant-pain check-in exists, and PROCEED (not
   PROGRESS) when a run lacks feedback.
5. `NEXT_STEPS.md` P0 first bullet updated to reflect what shipped.

## 8. Verification runbook

```bash
npm run migrate
npm run typecheck && npm test
PORT=3210 npm run web &
# pick a real recent activity id:
#   select id, name from activities order by start_date desc limit 5;
curl -s -X POST http://localhost:3210/actions/checkin \
  -d "activity_id=<ID>&rpe=6&pain_during=none&morning_soreness=normal" \
  -o /dev/null -w "%{http_code}\n"        # expect 303
curl -s http://localhost:3210/week | grep -c "Update check-in"   # expect >= 1
# GET must not mutate:
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3210/actions/checkin  # 405
```

Then open `/week` in a real browser and submit the form manually once — form
encoding differs from hand-built curl bodies and has caught bugs before.

**Note:** a real end-to-end review can only fire once a planned week has elapsed
(first candidate: the week of 2026-07-20, reviewable from Sunday evening 2026-07-26
per `reviewCutoffForReplan()`). Until then, done-criterion 4 is proven by tests, not
by the live database. Do not fake it by back-dating production rows.

## 9. Explicitly out of scope (later P0/P1 items — do not gold-plate)

- Immutable plan revisions (audit-proof replans) — separate task.
- Time-at-effort review, session purpose/required-optional roles — needs session IDs
  on *planned* sessions; separate task.
- Any LLM involvement. This loop is deterministic by design (PROJECT.md §3 still
  stands: deterministic decides, LLM phrases).
- Scheduled/automatic refresh; medical advice language. The check-in reports, the
  controller reacts, the copy stays descriptive.
