# Coach v2 — current state and next steps

Updated 2026-09-14 for the Patagonia Running Festival 21K on 2027-04-24.

> This is the single source of truth for project continuity and priority. Deep
> implementation details live in `docs/*.md`; they do not maintain a second roadmap.

## Current state

The end-to-end pipeline works: `Strava sync → fitness → current-shape estimate → weekly
review → next plan`, through either the CLI or the dashboard's **Update training** action.
Planning has a deterministic, no-API-cost path; LLM phrasing remains optional. The app is
hosted on Vercel and reads Supabase through a server-side Postgres connection. Direct
Supabase Data API access is deny-all: every application table has RLS enabled and public
roles have no grants.

As of 2026-09-14 the phase is `return_to_run`: 7 runs in the last 28 days against the 8
the gate requires. It briefly reached `base` a week earlier and fell back as older runs
aged out of the window — correct, if unintuitive. One strong week is not a base, and the
gate clears again on its own with three more runs.

The week of 2026-09-07 was the **first fully compliant week in the dataset**: 3 runs,
14.5km, key session completed at 45 min / 5.80km, every run under the 159 bpm easy
ceiling, and pace allowed to be an output rather than a target. Running CTL 7.31 → 8.91.

The binding constraint remains run *frequency*, not run length. The longest streak of
consecutive weeks with 3+ runs in the last 78 weeks is **8**, ending September 2025; a
race build needs roughly 29. 44 of those 78 weeks contained any running at all.

The race estimate is still paused, and only one of four reliability guards is holding it:
the longest run in 30 days (5.80km) makes a 21.1km estimate a 3.6x extrapolation against
a 3x limit. It unlocks at a **7.03km** run — three long runs away at the +10% session
guardrail.

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

### Where the goal actually stands (assessed 2026-09-14)

**Running 1:37:14 and winning the bracket are different questions with different
answers, and conflating them is the biggest strategic error in the plan.**

1:37:14 on a 250m-gain trail course is ~4:36/km, against a 4:39/km road PB from 2022 — it
asks the athlete to be faster than he has ever been, five years later, on harder terrain.
Current easy pace is 7:44/km at HR 143, against 6:30/km at the same HR twelve months ago.
Combined with the consistency record above, the honest read is **unlikely**.

Winning the bracket is a genuinely different proposition. The 2026 results: 1st 1:37:14,
**2nd 1:59:08**, 3rd 2:00:15. A 22-minute gap means the 2026 winner was an outlier (2nd
overall) who happened to be 18-29; the bracket's real standard is closer to 1:59. Sub-1:50
probably wins in a normal year, and sub-1:55 podiums.

The target was set to the 2026 winner's time on the assumption that is what winning costs.
It is not — it is the hardest number in the table. Chasing it is also the *riskier* path
to winning, because it pushes training beyond what the consistency record supports, which
is exactly how the previous three blocks ended.

Recommended re-anchor: primary goal **12 consecutive weeks of 3+ runs** (never yet
achieved, and the only variable that matters now); A-goal **sub-1:48**; 1:37:14 retained
as a stretch to be re-evaluated on evidence, not retired. Checkpoints: 15km continuous by
mid-December, a 10K time trial in early February (sub-44:00 keeps 1:37 alive), and an
18-21km trail long run with race-like vert in mid-March.

**Unverified input that moves all of this:** the 250m course gain is an assumption in
`predict/live.ts`. If Huemul is 600m+, every pace target above shifts and trail-specific
work matters far more than flat-road fitness.

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
11. Closes the feedback loop: per-session check-ins derive readiness, which is what makes
    PROGRESS and DELOAD reachable at all.
12. Looks **forward**: `deterministic/trajectory.ts` works backwards from race day to the
    weekly growth rate the goal still requires, and reports how many whole weeks can
    still be missed before the goal itself has to change.
13. Fits the athlete's real week: run days are inferred from his own history
    (`loadRunDays`, the twin of `loadStrengthDays`) rather than assumed from a template.
14. Checks its own output against **coaching properties** as well as the S2 validator —
    the tier that asks whether a legal week still makes sense for this athlete.

## Inputs still needed from Juan

The gym split is **configured** (2026-09-14): `ATHLETE_GYM_DAYS` and
`ATHLETE_LOWER_BODY_DAYS` are set in Vercel, which also settles red-team L2 for this
athlete — inference is no longer used for strength days. `ATHLETE_RUN_DAYS` exists as the
same escape hatch for run days if the inferred pattern is drift rather than preference.

**The one input still missing is the check-in, and it is now the single thing blocking
progression.** Zero check-ins have ever been recorded. Readiness gates PROGRESS, so every
week can reach PROCEED at best and volume stays flat no matter how well it was executed —
the week of 2026-09-07 was 100% compliant with the key session done, and still held.

The friction excuse is gone as of 2026-09-14: the prompt is on the Now page and one tap
submits the clean answer for every pending run. What it cannot do is invent the answer.
Missing feedback must never be treated as a green recovery signal.

## Spec & review library (Fable-written, cheap-model-implementable)

| doc | what | status |
|---|---|---|
| `docs/coach-v2-redteam-2026-07-19.md` | Adversarial review of the coaching model. **H1/H2/M3/M1 FIXED 2026-07-19; L1 FIXED 2026-08-23** (one `resolveHrMax()` in `zones.ts` — it resolves max HR to 201, so the easy ceiling is 159). Open: M2 (immutable plan revisions), L3. **L2 settled 2026-09-14** by configuring `ATHLETE_GYM_DAYS` — strength days are no longer inferred for this athlete. | H1/H2/M3/M1/L1 done |
| `docs/p1-forecast-implementation.md` | Anchored performance state + freshness-aware intervals + scenario forecast | spec ready |
| `docs/p1.5-training-anchors-implementation.md` | Mine streams for max-effort anchors (depends on P1) | spec ready |
| `docs/f4-eval-harness-implementation.md` | Golden set + property evals for the composed coach. **The property half shipped 2026-09-14** as `deterministic/coachProperties.ts`; the golden set and the historical replay harness are still unbuilt. | half shipped |

Suggested order: **~~red-team H1+H2+M3+M1+L1~~ → ~~P0~~ → ~~F4 properties~~ (done) → P1 → P1.5.**

P1 is the next substantial piece, but it is gated on evidence rather than engineering: it
needs a fresh performance anchor, and there is none until the 7km unlock (~3 weeks) and
realistically not until a February time trial. Calibrating a performance model against
nothing is the failure mode to avoid. The F4 golden set and replay harness are the
useful work in the meantime.

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
- **Controller defects C1/C2/C3 fixed 2026-09-07** (found by reading the live plan back
  against the athlete's own logged runs):
  - **C1 — the long run was the shortest run.** `LONG_RUN_SHARE_BASE` is 30%, but an
    even split across three run days is already 33%, so the key session came out
    *below* each easy run (a 2.6km "long run" beside two 3.1km easy runs).
    `longRunShare()` now floors the share at `1.2 / runDays`, so the long run stays
    ~20% longer than an easy day at any run-day count. The +10%-of-longest-recent-run
    session cap is unchanged and still binds first.
  - **C2 — the plan followed the athlete instead of leading.** `plannedRunVolumeCeiling`
    anchored only on `previousWeekKm`, so one interrupted week reset the baseline for
    good: the key session ratcheted 5.4 → 4.5 → 1.6km while the athlete's own longest
    run was 5.6km, and the prescription ended up smaller than what he ran unprompted —
    the failure mode where a plan becomes safe to ignore. The baseline is now
    `max(previousWeekKm, 0.8 × best of the last 4 completed weeks)`; a taper never looks
    backwards. Weekly volume and single-session length stay separate guardrails.
  - **C3 — key sessions were scored by date, not dose.** An all-easy week's key session
    is just the week's longest easy run, but `reviewWeek` only credited it within ±1
    day: 61 logged minutes against 45 planned, including a run 2.7× the planned key,
    scored REPEAT because it landed on Monday instead of Sunday. `keyMatchesAnyDay`
    (set for weeks with no high-intensity session) now credits it to the biggest
    qualifying run on any day. Weeks with real intensity structure keep the strict
    window — there, placement *is* the prescription.

  Not fixed, same class as C1: `oneHighDayWeek()` splits 18% high / 28% long / rest to
  the easy days, so a 3-run threshold week hands the single "easy" day 54% — the biggest
  run of the week. Unreachable until the build phase; fix it before the first threshold
  week is generated.

- **Race trajectory shipped 2026-09-07** (`src/deterministic/trajectory.ts`). Every other
  number in the controller looked backwards; nothing answered "where do I need to be in
  December?". Working backwards from race day — peak long run = race distance, peak weekly
  volume = that long run at no more than 40% of the week, minus the taper and one down
  week in four — gives the compounding growth rate the goal still needs, and compares it
  against the same +10%/week the S2 validator enforces. Output is on `/trajectory` and in
  the `plan:free` log.

  The useful number is **slack weeks**: how many whole weeks can still be lost before the
  goal needs unsafe progression. At ship time: +8.8%/week needed, **3 spare weeks**. That
  reframes the year from "train harder" to "don't skip", which is the honest constraint.

  **The trajectory may SHAPE growth, never CREATE it.** `plannedRunVolumeCeiling` applies
  the forward target only when `runningProgressionFactor` is already above 1.0 — i.e. when
  readiness has earned it — and still clamps to +10%. Being behind the curve is a reason to
  be *told*, not to be pushed: readiness outranks the calendar. It is also ignored entirely
  during a taper.

  Not built, and the natural next step: the trajectory is the training-side twin of P1's
  forecast. P1 says where you will land; this says what this week must be. Joining them
  ("you are two weeks behind a 1:45") is P1's job, not a fourth pillar.

  Stale review rows were left alone: `week_review` for 2026-08-31 still records the
  pre-C3 `REPEAT`, since re-scoring a stored review rewrites training history (see M2,
  immutable plan revisions). Progression is unaffected — REPEAT and PROCEED both
  multiply by 1.0.

- **The plan fits the athlete's real week** (2026-09-14, `02a0503`). `loadRunDays()` is
  the run-side twin of `loadStrengthDays()`: explicit `ATHLETE_RUN_DAYS` wins, else the
  habitual weekdays of the last 90 days (ranked by frequency, ties broken on the most
  recent run, needing >=6 runs before it trusts a pattern), else the template. The plan
  had prescribed Tue/Thu/Sun for **five consecutive weeks** to an athlete who ran
  Mon/Wed/Sun every time, and nothing noticed.

  The preference is an ANCHOR, never an override: it replaces the deviation target in
  `scheduleScore`, and the existing filters still reject consecutive run days,
  lower-body/key conflicts and missing rest days. *Adapt where sessions land, never what
  they are.* Also in this change: support sessions match on dose in an all-easy week (three
  runs had scored 2/3 because one landed on Monday); return-to-run copy drops the
  run/walk framing once the distance has been run unbroken; and the return-to-run
  explanation names the gate that actually fired instead of always quoting the gap.

- **One-tap check-in** (2026-09-14, `c937615`). P0 shipped the loop and adoption was
  zero. The prompt now appears on the Now page, and one button submits the clean answer
  for every pending run. Batching is a shortcut for *typing*, never for reporting: the
  button states a positive fact, so a tap is still an explicit athlete report. A batch
  that does not cover every run still cannot confirm readiness, and a batch reporting
  pain still raises the red flag — both tested.

- **Coaching properties** (2026-09-14, `16bbc6e`) — `deterministic/coachProperties.ts`.
  The tier above the S2 validator. Every defect found by reading the live plan against
  the real training log passed the validator cleanly; the week was *valid* every time.
  They were plans that were internally consistent and coaching nonsense — a category the
  validator cannot express, because each is about the plan's relationship to the
  ATHLETE rather than to the rulebook. Six properties, each with a regression test
  reproducing the defect that motivated it. Advisory, not hard rules: `freePlan` logs
  them rather than throwing, because a property can fail for a defensible reason.

- **The +10% session guardrail binds every run** (2026-09-14, `26e5c51`). The BJSM
  cohort is about a *single* run — any of them — exceeding the longest run of the prior
  30 days by more than 10%. The cap was applied only to the session the template called
  "key"; `oneHighDayWeek` had no session cap at all. A returning athlete whose longest
  run was 2km was prescribed **4km easy days**, double the guardrail, on exactly the days
  it was never checked. Found by the property matrix within an hour of adding it.

## Highest-priority product gaps

### ~~P0~~ — the feedback loop is closed (shipped 2026-09-07)

The controller was **structurally capped**: `reviewLatestCompletedWeek()` never passed
`readinessConfirmed` or `redFlag`, so `reviewWeek` could not return PROGRESS or DELOAD,
so `runningProgressionFactor` was pinned at 1.0 forever. Volume could never grow and
pain could never trigger a deload. Both halves of the adaptive loop dead-ended on a
missing check-in. That is now live:

- `POST /actions/checkin` (POST-only, 32 KB cap, PRG redirect to `/week`) upserts into
  `session_feedback`; `/week` renders a per-activity form for the last 10 days, prefilled
  and editable, with gym focus/difficulty on strength sessions.
- `reviewLatestCompletedWeek()` reads per-ACTIVITY rows (ids are what check-ins are filed
  under), derives readiness via `deriveReadiness()`, and persists the full audit trail —
  `readiness_confirmed`, `red_flag`, `readiness_reasons`, `runs_checked_in`, `runs_total`.
- Policy, unchanged from the spec and now enforced end to end: readiness requires EVERY
  run of the week checked in pain-free; one significant-pain or unusual-soreness report
  anywhere in the week (runs **or** gym) is a red flag; mild pain and missing reports sit
  between — completion counts, progression doesn't. Missing feedback is never green.
- `src/plan/review.test.ts` "readiness → review, composed" is the permanent regression
  net proving PROGRESS and DELOAD are reachable at all.

**Juan's part:** the loop only pays off if the check-ins get filled in. Nine activities
were awaiting one at ship time. A week with any run unchecked can reach PROCEED, never
PROGRESS — which means it holds volume flat, exactly as designed.

Still open from the original P0 scope, deliberately not built:

- Immutable plan revisions, so a replan cannot erase the prescription being audited
  (red-team M2 — the refresh button makes multi-generation of a week routine).
- Matching planned and actual sessions by stable session IDs, discipline, and
  required/optional role; reviewing time-at-effort rather than only kilometres.

### Open gaps found but deliberately not built

- **Frequency does not adapt when the session cap binds.** An athlete running 20km/week
  whose longest single run is 2km gets three runs capped at 2.2km — 6.6km, far below his
  actual behavior, and `not_below_recent_behavior` correctly fires. The right answer is
  more run *days*, not longer runs, but run-day count comes from phase alone. Not this
  athlete's profile; real for someone rebuilding on many short runs.
- **`oneHighDayWeek` share split.** 18% high / 28% long / remainder split across the easy
  days means a 3-run quality week hands the single easy day 54% — the biggest run of the
  week. Same class as the fixed long-run-share defect, unreachable until the build phase.
  Fix it before the first threshold week is generated.
- **Reviews are never recomputed.** `reviewLatestCompletedWeek` only reviews weeks with
  no existing row, so a logic fix leaves historical reviews stale — the 2026-09-07 row
  still records 2 of 3 runs under the pre-fix matching. Rewriting them is what red-team
  M2 exists to prevent, so this needs versioned reviews, not a backfill.

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
