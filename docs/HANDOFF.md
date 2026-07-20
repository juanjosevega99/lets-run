# HANDOFF — where the project is right now

> Living continuity doc so no context is lost between sessions. Last updated 2026-07-19.
> The permanent roadmap is `NEXT_STEPS.md`; the deep specs are the other `docs/*.md`.
> This file is the "pick up without re-reading everything" summary. Keep it short and
> current — when something here goes stale, fix it, don't append.

## The one-paragraph state

Single-user deterministic running coach for Juan's Patagonia 21K on **2027-04-24**
(target: win Varones 18-29, sub-1:37:14). The full pipeline works end-to-end:
`sync → fitness → current-shape estimate → weekly plan`, runnable via CLI or the
dashboard's **Update training** button (`POST /actions/refresh`). Coach v2 (Juan's own
refactor) added three load curves, training phases, a review controller
(PROGRESS/PROCEED/REPEAT/DELOAD), and duration-first return-to-run. No LLM is required
for planning (`plan:free` uses deterministic templates); the LLM path exists but needs an
API key Juan is not spending yet. Reality check that matters: Juan is **detrained** (running
CTL ~0.6, no run since 2026-04-29), so the app is correctly in `return_to_run` and the
race-time estimate is **paused** (see below).

## Git state

- Latest commit: `6443488 feat: implement reliability gating for predictions`.
- Auth (`src/web/auth.ts`) and the Vercel deploy workflow were **removed** by Juan
  (commits `077c3af`, `61c8fe0`) — the dashboard is local-only again.
- **Uncommitted (ready to commit): the red-team H1/H2/M3 fixes** — `schedule.ts`(+test),
  `redteam.test.ts`, and edits to `trainingPhase/weekTemplate/validator/context/freePlan/
  tomorrow` + doc updates. 319 tests green, typecheck clean.

## What shipped this session (2026-07-19)

1. **Pace prescription fix** (committed earlier): easy pace now comes from observed
   recent easy-HR runs (7:20/km), not best-ever VDOT (5:14/km); sessions lead with an HR
   ceiling. `src/deterministic/zones.ts`.
2. **Dashboard actions**: the refresh button + shared CLI/web cores (`pipeline/refresh.ts`).
3. **Prediction reliability gate** (committed, `6443488`): the dashboard no longer shows a
   fake-confident "1:48:37" half estimate off zero running. `src/predict/reliability.ts`
   withholds the number when running CTL ≤ 5 or there's no recent running; UI shows
   "Estimate paused". Juan caught this; the real accuracy fix is P1.
4. **Red-team H1/H2/M3** (uncommitted): see below.

### Red-team fixes just landed

- **H1 (was a crash):** the run-day scheduler protected the wrong key day for
  one-high-day weeks, so a valid `ATHLETE_LOWER_BODY_DAYS` config could make plan
  generation throw. Fixed by a shared `keyRunDay`/`isAllEasyWeek` in
  `src/deterministic/schedule.ts` used by scheduler + template + validator (single source
  of truth). Exhaustive regression in `src/plan/redteam.test.ts`.
- **H2 (wrong baseline):** Sunday-evening replans baselined next week's volume on the
  week *before* last. Fixed with `currentWeekIsComplete()` (clock now injectable for
  tests). `src/plan/context.ts`.
- **M3 (wraparound):** Sunday lower-body → Monday key run wasn't caught. Fixed via
  `lowerBodyConflictsWithKey` (mod-7) in scheduler + validator.

## Spec & review library (Fable-written, cheaper model implements)

Order: **red-team M1 (needs a decision) → P0 → F4 → P1 → P1.5.**

| doc | one-liner |
|---|---|
| `coach-v2-redteam-2026-07-19.md` | H1/H2/M3 done; M1/M2/L* open |
| `p0-checkin-implementation.md` | post-session check-in → unlocks PROGRESS/DELOAD (controller is capped without it) |
| `f4-eval-harness-implementation.md` | golden set + property evals for the composed coach |
| `p1-forecast-implementation.md` | anchored performance-state predictor + scenario forecast (the real fix for the paused estimate) |
| `p1.5-training-anchors-implementation.md` | mine streams for max-effort anchors (depends on P1) |

## Open decisions / inputs needed from Juan

- **Red-team M1:** how many consistent return weeks before the plan may add a 4th run
  day (spec suggests 5).
- **P1 §3.1:** confirm per-race `is_max_effort` / `confidence` flags (e.g. the
  sister-paced 5K is not a max effort; Rivera 2021 is low-confidence).
- **P0:** the 20-second check-in inputs (RPE, pain, soreness, gym focus) — only he can
  provide these; the software can't infer tolerance.
- Whether to ever spend on `ANTHROPIC_API_KEY` for LLM-phrased plans (optional; the
  deterministic path is complete without it).

## Invariants / gotchas (do not relearn the hard way)

- Postgres `DATE` columns come back as midnight-UTC `Date`; never `String()` them —
  use `dateOnly()`/`isoDate()` in `src/lib/time.ts`.
- Week bucketing uses `dashboardTz()` (default `America/Bogota`, no DST).
- The deterministic template must always pass its own validator, or
  `generateFreeWeekPlan` throws — F4's P-SAFE-1 property is the permanent net for this.
- Predictions: `livePredictions` treats a row as reliable unless `context.reliable` is
  explicitly `'false'`, so old rows aren't retroactively hidden.
- `npm run build` === `npm run typecheck`; keep both + `npm test` green before committing.
