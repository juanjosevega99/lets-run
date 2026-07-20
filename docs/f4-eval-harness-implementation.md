# F4 implementation spec — the eval harness (golden set + properties)

> **Audience:** an implementing agent/model with NO prior context. Fourth doc in the
> series; same format. PROJECT.md F4 promised "golden set (~30 cases) + hard-rule
> validator + LLM-as-judge"; this spec delivers the first two **for the deterministic
> coach** and stubs the third. Written 2026-07-19; verify anchors before editing.
>
> Relationship to tests: unit tests pin *functions*; the eval harness scores the
> *composed coach* (context → phase → focus → template → validator → review) across a
> curated situation library, and reports a scorecard instead of pass/fail-only. Evals
> may degrade without failing CI hard (except safety invariants, which are hard).

## 1. Architecture

```
evals/
  fixtures/*.json          ~30 golden situations (PlanContext-shaped inputs + expectations)
  properties.ts            randomized invariant checks (hand-rolled generator, no new deps)
  goldens.test.ts          runs fixtures through the real pipeline (pure parts only)
  run.ts                   `npm run eval` → scorecard table (also vitest-runnable)
```

Everything runs against **pure functions only** (`buildWeekTemplate`,
`selectTrainingPhase`, `selectTrainingFocus`, `phaseRunDays`, `validateWeek`,
`reviewWeek`, progression helpers). No DB, no network, deterministic, < 5 s total.
`buildPlanContext` (SQL) is exercised by one thin smoke eval only if a DB is
available (`SKIP_DB_EVALS=1` skips; CI default skip).

## 2. The golden set (~30 fixtures)

Each fixture: `{ name, why, input, expect }` where `input` is the template/phase
input (subset of `PlanContext`) and `expect` is **structural**, not string-based
(never snapshot prose — copy churns).

Situations to cover (grouped; one fixture each unless noted):

**Return & safety (8):** long layoff (today's real state — CTL 0.6, 78 d gap);
layoff + heavy cycling week (aerobicTsb ≪ 0); return week 3 (about to graduate);
first week post-return (the M1 cliff from `docs/coach-v2-redteam-2026-07-19.md` —
pin whatever gate is implemented); red-flag previous decision → DELOAD shrink;
zero-baseline first-ever week; return with configured lower-body days colliding
with default run days; single-run-spike guard (longest30d small).

**Phase ladder (6):** base / build / race_specific / taper by daysToRace with
continuity; taper volume ×0.75; race_specific with stale quality share → threshold
limiter; unknown quality share → aerobic_base fallback.

**Controller (6):** PROGRESS → ×1.05 exactly; PROCEED/REPEAT → flat; DELOAD → ×0.8;
running-TSB guard −20; aerobic-TSB guard; PROGRESS while guard active (guard wins).

**Review matrix (6):** perfect week; missed key + done filler; done key + missed
filler (60–85%); < 60% compliance; extra unplanned volume (compliance capped 100%,
no PROGRESS without readiness); red flag overrides everything.

**Scheduler (4):** lower-body day displacement respects key-day protection (both
template shapes — regression for red-team H1); Sunday↔Monday wraparound (H3/M3);
strength days rendered on configured days; rest-day completeness (all 7 days
accounted).

Expectations vocabulary (implement as small assertion helpers):
`validatorClean`, `runDays`, `keyDay`, `keyIntensity`, `totalKmBetween`,
`progressionFactor`, `decision`, `sessionCount`, `hasRestDayCount`,
`noConsecutiveImpactDays`, `strengthOnDays`.

## 3. Property checks (`evals/properties.ts`)

Hand-rolled seeded PRNG (mulberry32, inline — **no new dependency**), ~500 random
contexts per property, seed printed on failure and overridable via env for replay:

- **P-SAFE-1 (hard):** for every generated context, `buildWeekTemplate` output passes
  `validateWeek` with zero violations — the template must never emit what the
  validator rejects (this is the invariant whose violation crashes the refresh
  pipeline today; red-team H1 is a known counterexample until fixed — the property
  test is its permanent regression net).
- **P-SAFE-2 (hard):** ≥ 1 full rest day; no two high days adjacent (mod 7); high
  share ≤ 25% of km; return weeks: exactly 3 nonconsecutive run days, no high.
- **P-CTRL-1:** planned km ≤ ceiling ≤ baseline × 1.05 + ε for all decisions;
  ceiling monotone in decision (DELOAD ≤ hold ≤ PROGRESS).
- **P-CTRL-2:** determinism — same input twice → deep-equal output.
- **P-REV-1:** `reviewWeek` totality — every generated planned/actual pair yields
  exactly one decision; compliance ∈ [0, 100]; `redFlag ⇒ DELOAD`;
  `!keyCompleted ⇒ REPEAT` (unless red flag); PROGRESS ⇒ readinessConfirmed.
- **P-REV-2:** adding unplanned extra runs never upgrades the decision.

Generator ranges: baseline km 0–60, TSBs −40…+15, all phases, decisions incl. null,
run-day sets from `phaseRunDays` plus adversarial sets, lower-body days ⊆ 0–6.
Properties marked **hard** run in `npm test` (CI-blocking); the rest run in
`npm run eval` and report.

## 4. Scorecard (`npm run eval`)

Plain table to stdout: golden pass count by group, property pass/fail with seed,
and a "behavior drift" section listing goldens whose *non-asserted* numeric outputs
(total km, key km) changed vs a committed `evals/baseline.json` (regenerate
intentionally via `npm run eval -- --update-baseline`). Drift is information, not
failure — the point is noticing silent coaching changes when constants move.

## 5. LLM-path evals (stub only, keyless-safe)

When `ANTHROPIC_API_KEY` is present and `--llm` passed: run the golden contexts
through `generateWeekPlan` with the real model, score validator-pass-rate on first
attempt, retry count, and cost; assert nothing except pass-rate ≥ 0.8 (warn below).
LLM-as-judge for explanation quality: **explicitly deferred** — write the seam
(`judgePlan(plan): Promise<Score>` interface, unimplemented, throwing) and stop.
Without a key the whole section reports "skipped (no credentials)".

## 6. Runbook + DoD

```bash
npm run eval          # scorecard, exit 0 unless a hard invariant fails
npm test              # includes hard properties + goldens
```

Done when: ~30 goldens grouped as §2 with a one-line `why` each; hard properties
wired into `npm test`; scorecard + baseline drift working; red-team H1 reproduced
by P-SAFE-1 *before* its fix and green after; README gains a five-line evals
section; NEXT_STEPS F4 pointer updated.

## 7. Out of scope

- Evaluating prediction accuracy (that is F2's backtest — different judge).
- Multi-week simulation evals (season-level rollouts) — valuable, separate doc.
- Any UI. Any new dependency. Any change to the modules under test beyond what
  red-team fixes already specify.
