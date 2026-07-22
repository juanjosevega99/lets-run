# Coach v2 — adversarial model review (snapshot 2026-07-19)

> Scope: the deterministic coaching model (`trainingPhase`, `weekTemplate`, `validator`,
> `review`, `banister`, `stress`, `plan/context`) as of commit `a2d5d68` + the
> uncommitted working tree. **Out of scope:** `src/web/auth.ts` (mid-flight cookie-session
> work), the P0/P1 specs (already documented), UI copy.
> Line anchors are approximate — verify before editing.
>
> Method: hypothesis-driven code reading. Several initial suspicions were checked and
> **dismissed by evidence** (§4) — only §2 items are claimed as real.

## 1. What the refactor got right (credit, so nobody "fixes" these back)

- **Strength classified before TRIMP** (`stress.ts`): lifting HR no longer inflates
  aerobic fatigue. Correct and important.
- **Like-with-like TSB** (`banister.ts`): the old running-CTL-minus-all-sport-ATL
  "form" score was physiologically meaningless; three parallel curves fix it.
- **Measured threshold share** (`context.ts` → `recentThresholdTimeShare`): the old
  hardcoded `qualityShare28d = 1` (which made the threshold limiter unreachable) is
  gone — per-second HR stream analysis with a sensible per-sample dt cap.
- **Threshold pace gated on a fresh anchor** (≤180 d race) instead of best-ever VDOT.
- **Structural validation at the boundary** (`validator.ts`): NaN/negative/fake-rest
  guards, return-to-run frequency/spacing/spike rules, floor-rounding so per-session
  rounding can't breach the weekly cap.
- **Sunday-evening review grace** (`reviewCutoffForReplan`): a breakfast refresh can't
  mark Sunday's key run as missed.

## Status (updated 2026-07-19, evening)

**H1, H2, M3, M1 are FIXED** (implemented + regression-tested). H1/M3 via the shared
`src/deterministic/schedule.ts`; H2 via `currentWeekIsComplete()` in `plan/context.ts`;
M1 via `targetRunDays()` + soft 4-day spacing in `deterministic/trainingPhase.ts`.
Tests: `src/plan/redteam.test.ts`, `src/deterministic/schedule.test.ts`,
`src/deterministic/trainingPhase.test.ts`.

**M1 decision made:** `RUN_DAY_STEP_UP_RUNS_28D = 12` — a returning athlete holds 3 run
days through early base until ~4 weeks of ~3 runs/week (runs-in-28-days ≥ 12), then steps
to 4. Sensible default in lieu of Juan's call; it's a one-constant tune in
`trainingPhase.ts`. 4-day spacing is now a soft score (prefer [0,2,4,6], keep the key run
out of any back-to-back pair) — never a hard filter, since only [0,2,4,6] is fully spaced
and a lower-body conflict can force a tighter week.

**Still open:** M2 (immutable plan revisions — its own task), L1 (duplicated HR-max clamp),
L2 (strength-day over-inference — note: the live plan currently infers 5 strength days),
L3 ("Workout"-type activity channel). The per-finding detail below is kept for the record.

## 2. Findings (ranked)

### H1 — Reachable hard crash: the scheduler protects the wrong "key day" · HIGH

**Where:** `trainingPhase.ts` → `phaseRunDays()` vs `weekTemplate.ts` →
`oneHighDayWeek()` vs `validator.ts` → `lower_body_before_key` vs `freePlan.ts` throw.

**Chain:** `phaseRunDays` filters lower-body conflicts assuming the key session is the
**last** run day (`days.at(-1)`). That holds for all-easy weeks. But
`oneHighDayWeek` (threshold / race_specific limiters) makes the key session the
**second** run day (`x.runDays[1]`), and `freePlan` passes that day to the validator,
which enforces `lower_body_before_key`. The scheduler never protected that day.

**Concrete trigger:** `ATHLETE_LOWER_BODY_DAYS=1` (Tuesday — a normal choice), phase
`build`, limiter `threshold` → runDays default `[0,2,4,6]` (day 6 checked, passes),
key session lands on day 2 (Wednesday), validator sees lower-body on day 1 →
violation → `generateFreeWeekPlan` **throws** ("template produced an invalid week"),
the refresh pipeline's plan step fails, the dashboard keeps a stale week. The UI and
NEXT_STEPS actively ask Juan to configure exactly these env vars, so this is a
time-bomb on the intended configuration path, reachable the moment the phase
advances out of all-easy weeks.

**Fix:** make `phaseRunDays` key-day-aware: accept (or compute) which index is the
key day per template shape (`isAllEasy` → last; else second) and filter/score
against that day; alternatively have `oneHighDayWeek` choose its key day with the
same lower-body constraint applied. Add a test: lower-body on day 1 (and on
`keyDay`), phase build/threshold → zero violations, no throw.

### H2 — Sunday-evening replans baseline volume on the wrong week · HIGH

**Where:** `plan/context.ts` → `buildPlanContext`: `weeklyRunVolume(sql, 5)` then
`completedWeeks = weeks.slice(0, -1)` → `previousWeekKm = completedWeeks.at(-1)`.

**Problem:** `weeklyRunVolume`'s last entry is the *current calendar week*, which is
dropped as "incomplete". On the recommended Sunday-evening flow
(`reviewCutoffForReplan` explicitly supports it), the week being finished IS the
current week — so it's dropped, and `previousWeekKm` comes from **two weeks ago**.
Meanwhile the review in the same replan evaluates the just-finished week. The
controller then progresses volume off a stale baseline: e.g. ran 12 km this week,
9 km last week → Sunday replan plans next week from 9 km (and a PROGRESS verdict
earned on the 12 km week multiplies the wrong base).

**Fix:** compute the baseline consistently with the review cutoff: when
`reviewCutoffForReplan()` returns `nextMonday()` (Sunday-evening case), treat the
current week as completed (`completedWeeks = weeks` minus nothing). Simplest shape:
pass the cutoff into `buildPlanContext` and slice relative to it. Add a test with a
fake "Sunday 19:00" clock.

### M1 — The return→base cliff: 3 impact days becomes 4 overnight, spacing rule vanishes · MEDIUM

**Where:** `trainingPhase.ts` → `selectTrainingPhase` + `phaseRunDays`.

Exiting `return_to_run` needs `runs28d ≥ 8 && activeRunWeeks4 ≥ 3 && gap ≤ 21d` —
achievable in exactly 3 weeks of the 3-run prescription. The next plan jumps to 4
run days (`[0,2,4,6]`), a +33% impact-frequency step, and the nonconsecutive-days
requirement is only enforced for 3-day sets (`requiresSpacing = defaults.length === 3`),
so lower-body-avoidance can legally produce back-to-back run days in week 4 of a
comeback. His own evidence guardrail (BJSM 2025, single-run spikes) is about exactly
this class of jump. **Fix:** add an intermediate gate (e.g. ≥ 5–6 active return weeks
or a PROGRESS-count threshold before 4 days), and extend the spacing filter to 4-day
sets (allow at most one adjacent pair, never involving the key day).

### M2 — Replans overwrite the audited prescription · MEDIUM (known, now with a sharper edge)

`plan_week` upserts by `week_start` (`freePlan.ts`). A Sunday-evening replan writes
next week; a Monday re-press regenerates it under post-H2-fix inputs and silently
replaces it. Combined with the review reading `plan_week` a week later, the
prescription being audited can differ from the one that was shown. Already listed in
NEXT_STEPS P0 ("immutable plan revisions") — this review just confirms it's not
theoretical: the refresh button makes multi-generation of the same week routine.
Fix direction is in `docs/p0-checkin-implementation.md` §9 (out of scope there;
schedule it).

### M3 — Weekday wraparound blind spot: Sunday lower-body vs Monday key · MEDIUM-LOW

Both `phaseRunDays` (`lower.has(keyDay - 1)` guarded by `keyDay > 0`) and
`validator.ts` (`lower_body_before_key`, same shape) skip the Sunday(6)→Monday(0)
adjacency. A configured Sunday lower-body session immediately before a Monday key
run is exactly the pattern both rules exist to prevent. **Fix:** compare modulo 7 in
both places (`(keyDay + 6) % 7`), one shared helper, tests for the wrap case.

### L1 — Duplicated HR-max clamp logic · LOW

`fitness/rebuild.ts` and `plan/context.ts` each implement the "observed max HR,
clamp to [170, 210], else 193" rule independently. Drift here silently desyncs the
load model from the prescription zones. Extract one function into
`deterministic/zones.ts`.

### L2 — Strength-day inference can over-require days · LOW

`loadStrengthDays` marks every weekday with `sessions ≥ max(2, max·0.5)` over 120
days as a required strength day; a habit change (e.g. Mon→Tue migration) can leave
3–4 "required" days that the validator then enforces weekly
(`missing_strength_day`), padding plans with phantom gym sessions. Consider a
shorter window (42–56 d) and cap at the athlete's actual weekly gym frequency
(median sessions/week).

### L3 — "Workout"-type activities take the TRIMP branch · LOW

`stress.ts`: `isStrength` matches only `weight|strength`; his history contains 7
generic `Workout` activities which, when they carry HR, are scored as aerobic TRIMP
and feed `aerobicStress`... but `isAerobic` excludes them, so they load `totalStress`
only via TRIMP-derived stress — inconsistent channel assignment for one activity
type. Decide: treat `Workout` as strength (likely, given his usage) or document.

## 3. Cross-cutting observations (no action required now)

- `runs_28d` window uses UTC while `days_since_last_run` uses the dashboard TZ —
  off-by-hours at boundaries, immaterial at n=weekly.
- Post-day TSB semantics are documented in `banister.ts`; the -20 guardrail values
  were chosen under the old semantics — worth a one-time sanity pass when tuning.
- `reviewWeek`'s day-±1 matching cannot see a Sunday key run performed the following
  Monday (outside the week window). Acceptable; document in the P0 implementation.

## 4. Suspicions checked and dismissed (so they aren't re-litigated)

- *"Strength sessions inflate the review's planned running dose"* — false: template
  strength sessions carry `planned_km: 0` and no `planned_minutes`, so the
  `plannedRuns` filter excludes them and `match()` short-circuits true. (A UI test
  fixture with `planned_minutes: 45` on strength misled the hypothesis; the template
  never emits that. Keep it that way — add a regression test pinning that template
  strength sessions never carry minutes.)
- *"Return-to-run km can floor to 0 and trip `return_to_run_frequency`"* — false for
  all reachable baselines (min ratio 0.27 × ≥1 km baselines stays ≥ 0.1 after
  floor1).
- *"Polarized rule breaks because high sessions include warm-up km"* — false at the
  18% high share (82% low ≥ 75% floor).

## 5. Suggested fix order

1. **H1** (crash on intended config) + its test — small, isolated.
2. **H2** (wrong baseline on the flagship flow) — small once cutoff is threaded.
3. **M3** (shared mod-7 helper) — trivial, do with H1 since both touch the same rules.
4. **M1** (frequency gate) — needs a small design call from Juan (how many return
   weeks before 4 days; suggest 5).
5. **M2** — schedule as its own task per P0 §9.
6. L1–L3 as cleanup alongside whichever file is already open.

All fixes are cheap-model implementable; H1/H2/M3 need no product decisions.
