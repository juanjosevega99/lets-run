# Coach v2 — current state and next steps

Updated 2026-07-21 for the Patagonia Running Festival 21K on 2027-04-24.

> This is the single source of truth for project continuity and priority. Deep
> implementation details live in `docs/*.md`; they do not maintain a second roadmap.

## Current state

The end-to-end pipeline works: `Strava sync → fitness → current-shape estimate → weekly
review → next plan`, through either the CLI or the dashboard's **Update training** action.
Planning has a deterministic, no-API-cost path; LLM phrasing remains optional. The app is
hosted on Vercel and reads Supabase through a server-side Postgres connection. Direct
Supabase Data API access is deny-all: every application table has RLS enabled and public
roles have no grants.

The athlete is currently rebuilding running tolerance, so the correct phase is
`return_to_run`. The race estimate remains paused until recent running provides enough
evidence for a defensible number. Readiness outranks the calendar.

## First coaching verdict

The calendar says there are about nine months to prepare, but readiness outranks the
calendar. At this review there had been no run since 2026-04-29, while cycling and gym
work continued. That preserves useful general capacity; it does not prove that the legs
currently tolerate five running days or threshold work.

The correct phase is therefore **return to running**, not a normal base/build week:

- Three nonconsecutive, conversational run/walk sessions.
- Duration first (roughly 20, 25, and 30 minutes before fatigue adjustments); distance is
  a secondary estimate.
- No threshold, hills, strides, or race-pace work yet.
- Full-sentence talk test is primary; HR is a secondary ceiling; old race pace is not a
  target.
- Keep gym work visible, keep at least one full rest day, and avoid heavy legs immediately
  before the longest run once lower-body days are configured.
- Progress only after the key session and most of the week are completed without a red
  flag. A missed key session repeats the focus; whole-program overload deloads it.

The target remains sub-1:37:14 for the 21K trail course. Under the app's current course
assumptions, that requires substantially better fitness than the 1:38:19 road PB; the
2026 age-group winning time is a benchmark, not a guarantee of winning in 2027.

## What Coach v2 now does

1. Separates three load curves:
   - running-specific chronic/acute load and balance;
   - combined aerobic load from running plus cross-training;
   - whole-program load including strength.
2. Uses whole-program balance to protect recovery without letting cycling or lifting
   masquerade as running fitness.
3. Selects return/base/build/race-specific/taper from race date **and** readiness.
4. Infers recurring gym weekdays and accepts explicit gym/lower-body-day configuration.
5. Generates three nonconsecutive, duration-first run/walk sessions after a long gap.
6. Reviews the last completed plan and emits PROGRESS / PROCEED / REPEAT / DELOAD.
7. Matches a run moved by one day and caps extra-volume compliance at 100%.
8. Rejects negative/invalid distances, fake rest days, unsafe return frequency or
   intensity, and single-run spikes.
9. Refreshes Strava → load → current-shape estimate → review → plan in one pipeline.
10. Labels the dashboard honestly: workload is not physiology, and today's shape estimate
    is not a race-day forecast.

## Inputs still needed from Juan

The most valuable next input is the gym split. Set `ATHLETE_GYM_DAYS` and
`ATHLETE_LOWER_BODY_DAYS` in `.env` using 0=Monday through 6=Sunday. Strava's
`Weight Training` label cannot distinguish upper, lower, or full-body work.

The next product input is a 20-second post-session check-in:

- Session RPE (1–10).
- Pain during the run.
- Pain or unusual soreness the next morning.
- Gym focus and lower-body difficulty.

Without those signals the software can measure completion and external load, but it
cannot know whether impact was tolerated. Missing feedback must never be treated as a
green recovery signal.

## Spec & review library (Fable-written, cheap-model-implementable)

| doc | what | status |
|---|---|---|
| `docs/coach-v2-redteam-2026-07-19.md` | Adversarial review of the coaching model. **H1/H2/M3/M1 FIXED 2026-07-19; L1 FIXED 2026-08-23** (one `resolveHrMax()` in `zones.ts` — it resolves max HR to 201, so the easy ceiling is 159). Open: M2 (immutable plan revisions), L2 (strength-day over-inference — live plan still infers 5 gym days), L3. | H1/H2/M3/M1/L1 done |
| `docs/p0-checkin-implementation.md` | Post-session check-in that unlocks PROGRESS/DELOAD | spec ready |
| `docs/p1-forecast-implementation.md` | Anchored performance state + freshness-aware intervals + scenario forecast | spec ready |
| `docs/p1.5-training-anchors-implementation.md` | Mine streams for max-effort anchors (depends on P1) | spec ready |
| `docs/f4-eval-harness-implementation.md` | Golden set + property evals for the composed coach (P-SAFE-1 is the permanent regression net for red-team H1) | spec ready |

Suggested order: **~~red-team H1+H2+M3+M1+L1~~ (done) → P0 → F4 → P1 → P1.5.** (red-team L2 — strength-day over-inference — is a cheap cleanup worth folding into P0.)

### Shipped since, not yet specced anywhere

- **Zones view** (`/zones`): HR bands from the athlete's own observed max, observed pace
  per band, easy-share vs the 80% polarized target and its per-run trend.
  `deterministic/zoneTime.ts` bins per-sample HR streams; `deterministic/zones.ts` owns
  the band model and `resolveHrMax()`.
- **Readiness tiles** on the overview: Fatigue / Recovery / Injury risk, the last from
  `deterministic/injuryRisk.ts` (ACWR, withheld while the chronic base is near zero).
- **Plan targets the current week**, not always next Monday (`freePlan.ts` now uses
  `reviewCutoffForReplan()`); return-to-run session *duration* inherits the same growth
  cap its distance already had.

## Highest-priority product gaps

### P0 — close the real feedback loop

> **Implementation spec ready:** `docs/p0-checkin-implementation.md` — self-contained
> handoff (evidence, locked policy, file-by-file plan, tests, runbook). Two artifacts
> already in the tree: `migrations/005_session_feedback.sql` (applied 2026-07-21) and
> `src/plan/feedback.ts` (policy + form parser, still needs its tests and UI wiring).

- Add activity/session feedback and surface medical stop flags.
- Match planned and actual sessions with stable IDs, discipline, duration, purpose, and
  required/optional role.
- Review time-at-effort and duration, not only kilometers.
- Store immutable plan revisions so a replan cannot erase the prescription being audited.

### P1 — make the nine-month forecast real

> **Implementation spec ready:** `docs/p1-forecast-implementation.md` — self-contained
> handoff (measured defects, performance-state model with calibrated CTL bridge,
> freshness-aware intervals, scenario forecast, tests, runbook). Needs Juan's
> max-effort/confidence confirmations for the race table (defaults proposed in §3.1).
>
> **Interim honesty fix shipped 2026-07-19, hardened 2026-08-23:** the symptom of defects
> D1/D2 (an over-optimistic ~1:48 current-shape estimate off almost no running) is GATED
> at display in `src/predict/reliability.ts`; `live.ts` marks the row
> `context.reliable=false` and drops its band; Now/Trajectory show "Estimate paused".
> Three guards now, after the first one leaked (see D4 in the spec): running CTL must
> clear the bridge's saturation floor **by a margin** (CTL 5.10 vs a floor of 5 was
> enough to unpause 1:48:29 on 2026-08-23), there must be recent running, and the target
> distance must be **within 3x the longest recent run** — a 21.1K estimate off a 4.97K
> longest run is outside the model's valid domain. The full accuracy rebuild (right
> anchor + calibrated bridge + an explicit validity domain) is still this P1 spec.

- Keep `current_shape_estimate` separate from a future `race_day_forecast`.
- Add planned-training / reduced-adherence / maintain-current-load scenarios.
- Add milestone tests only after several consistent, pain-free run weeks provide a fresh
  performance anchor.
- Curate race records with official/chip time, terrain, maximal-effort flag, and confidence;
  stop treating every Strava moving time as equally trustworthy.
- Replace best-ever VDOT and a small in-sample error band with recency-aware performance
  state and chronological calibration.

### P2 — make run + strength prescription specific

- Capture strength duration, focus, hard sets or session RPE, and lower-body difficulty.
- Shift strength from development → maintenance → taper across the race cycle.
- Add trail/course-specific long runs, descending tolerance, terrain, fueling, and race
  rehearsal after the return/base gates are passed.
- Calibrate cross-training transfer instead of assuming that every aerobic stress point is
  equally useful for race performance.

## Evidence guardrails

- A randomized trial did not find that a generic weekly 10% progression rule prevented
  injury: https://pubmed.ncbi.nlm.nih.gov/17940147/
- A 2025 cohort found higher overuse-injury rates when one run exceeded the longest run in
  the prior 30 days by more than 10%; the coach uses that as a conservative session-level
  guardrail: https://bjsm.bmj.com/content/59/17/1203
- Strength training can improve running economy, so gym is part of the performance plan,
  not merely fatigue to remove: https://pubmed.ncbi.nlm.nih.gov/38165636/

These are population findings, not medical diagnosis or proof that one threshold is
optimal for this athlete. The weekly controller should be calibrated from Juan's own
completion, RPE, pain, soreness, and performance response.

## Engineering invariants

- Postgres `DATE` values return as midnight-UTC `Date` objects. Use `dateOnly()` or
  `isoDate()` from `src/lib/time.ts`; never stringify them directly.
- Week bucketing uses `dashboardTz()` (default `America/Bogota`).
- The deterministic template must pass its own validator. A validation failure is a bug,
  not a plan-generation outcome.
- Historical unreliable prediction rows remain stored for auditability; display code
  must respect `context.reliable=false`.
- `npm run build` is the typecheck. Keep it and `npm test` green before shipping.
- Keep this file current by editing stale statements rather than appending session logs.
