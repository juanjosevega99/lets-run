# P1 implementation spec — a real current-shape estimate and a real race-day forecast

> **Audience:** an implementing agent/model with NO prior context. Companion to
> `docs/p0-checkin-implementation.md` (same handoff format). Written 2026-07-19 against
> commit `a2d5d68` + uncommitted working-tree changes. Verify file anchors before
> editing; the repo moves fast.
>
> **Scale of claims:** the race history has 8 races, of which roughly 6 are honest
> maximal efforts. Every statistical statement below is *indicative on tiny n*, and the
> implementation must keep saying so in UI copy and reports. Do not present fitted
> constants or narrow bands as guarantees.

---

## 1. The three defects this spec fixes (measured, not hypothetical)

All three were demonstrated on the real database in the 2026-07-19 backtest
(`npm run backtest`, predictors `riegel-v1` / `vdot-v1` / `vdot-ctl-v1`):

**D1 — Anchor selection is "best ever", not "most representative now".**
`src/deterministic/predictors.ts` → `referenceRace()` picks the highest-VDOT prior
race in a 24-month window, else all-time best. Failure modes on record: the 2019
prediction anchored on the 2018 mountain 2:09 half (VDOT 33 for a then-VDOT-48 runner,
+41% error); Cartagena 2022 anchored on a stale weak 10K across the 2021→22 fitness
surge (+10…+20% across models); today's live estimate anchors on a **2019** 10K
(VDOT 48.6) because it beats every 2022 half on VDOT — a 7-year-old anchor.

**D2 — The uncertainty band is in-sample and pooled.**
`src/predict/live.ts` → `backtestErrors()` pools ALL of a model's backtest errors —
cold-start garbage included — into one quantile band. Result: today's estimate
1:48:37 with a 1:27–2:07 band (≈ ±18%). Yet the errors split cleanly by anchor
freshness: predictions whose anchor was a recent honest race (the three
post-Cartagena 2022 predictions) had MAE ≈ **1.7%**; stale-anchor predictions were
+10…+41%. The band ignores the one variable that explains it.

**D3 — There is no race-day forecast at all.**
`generateLivePrediction()` correctly refuses to call itself a forecast (see its doc
comment and `estimate_kind: "current_shape"`). Nothing answers Juan's actual
question: *"What will I plausibly run on 2027-04-24, under what training, and am I
on track?"* The gap-to-target on the dashboard compares a detrained *today* against
a race-day goal — honest but almost useless nine months out.

## 2. Conceptual model (read this before the file plan)

Split the athlete into **traits** and **condition**:

- **Traits** — slow-moving properties of *how he runs*: personal Riegel exponent
  (endurance falloff), hill cost, HR zones. Calibrated from ALL max-effort history;
  a 2022 race teaches traits forever.
- **Condition** — fast-moving aerobic readiness, driven by recent training load.
  Proxied by running CTL (`fitness_state.ctl`, Banister, already built).

A race observation measures *condition at that date* (as VDOT) plus traits. So:

```
current VDOT ≈ VDOT(anchor race) × bridge(CTL_now / CTL_anchor)
```

The **anchor** is the most recent trustworthy observation, NOT the best-ever one
(fixes D1). The **bridge** is the existing CTL-ratio idea from `vdot-ctl-v1`, but its
exponent is *calibrated from his own race pairs* instead of the guessed `0.06`
(§3.3). Prediction uncertainty is a function of **anchor staleness** (fixes D2). A
**forecast** is the same machinery run on a *projected* CTL at race day under an
explicit training scenario (fixes D3). Milestone races collapse forecast uncertainty
by re-anchoring — that is a first-class concept, not a nice-to-have (§3.6).

## 3. Locked design decisions

### 3.1 Race-record curation (migration 006)

```sql
alter table races
  add column is_max_effort boolean not null default true,
  add column timing_source text not null default 'strava_moving'
    check (timing_source in ('chip', 'strava_moving', 'estimate')),
  add column confidence text not null default 'medium'
    check (confidence in ('high', 'medium', 'low'));
```

- Anchors and trait calibration use **only** `is_max_effort = true` races.
- `confidence` scales interval widening (low-confidence anchor → wider band; exact
  factor in §3.4). `timing_source` is provenance for the answer key (~1–2 min noise
  when `strava_moving`).
- Extend `races.template.csv` + `src/ingest/racesCsv.ts` with the three columns
  (optional, defaulted; comment lines explain). ⚠️ csv-parse gotcha already
  documented in repo memory: values must avoid commas/double-quotes.
- **Inputs needed from Juan** (only he knows; ship defaults, ask him to confirm —
  do NOT silently guess in production data):

| race | suggested default | why |
|---|---|---|
| 2018 Media maratón (2:09, 440 m gain) | max_effort=true, confidence=low | first-ever half, hilly; honest effort, weak anchor |
| 2019 Cali 10K (42:20) | true, medium | |
| 2020 Carrera de la mujer 5K (27:56) | **false** | he paced his sister (own Strava titles that week) |
| 2021 Race Rivera 10K (51:10) | true, **low** | 287 m gain; anomalously slow vs his 2021 training |
| 2022 mountain half (2:02, trail) | true, medium | |
| 2022 Cartagena / Cali / Medellín halves | true, medium–high | the reference cluster |

### 3.2 Performance state (`src/deterministic/performanceState.ts`, new, pure)

```ts
export interface PerformanceObservation {
  raceId: number; date: Date; vdot: number;
  confidence: "high" | "medium" | "low";
  ctlAtObservation: number;           // running CTL from fitness_state at that date
}
export interface PerformanceState {
  vdotNow: number;
  anchor: PerformanceObservation;     // provenance for UI/logs
  bridgeExponent: number;             // the k actually used
  stalenessDays: number;
  ctlShift: number;                   // |CTL_now − CTL_anchor| / max(CTL_anchor, 5)
}
export function currentPerformanceState(
  observations: PerformanceObservation[], ctlNow: number, asOf: Date,
): PerformanceState
```

Anchor rule (v1, deliberately simple): the **most recent** max-effort observation.
If two or more fall within 90 days of each other at the recency frontier, use the
highest-confidence one, tie-broken by the higher VDOT. Rationale: with n≈6, fancy
decay-weighted blends are noise laundering; the upgrade path (inverse-variance blend)
is noted in code comments, not built.

Bridge: `vdotNow = anchor.vdot × (max(ctlNow,5) / max(ctlAtObservation,5)) ** k`,
k clamped to `[0.03, 0.20]`. CTL floors avoid ratio explosions (existing pattern in
`vdot-ctl-v1`).

### 3.3 Calibrating the bridge exponent k

New pure function in `performanceState.ts`:

```ts
export function fitBridgeExponent(observations: PerformanceObservation[]): number | null
```

For every ordered pair (i, j), j later, both max-effort, with
`ctl_i, ctl_j ≥ 5` and `|ln(ctl_j/ctl_i)| ≥ 0.2` (a real load change):
`k_ij = ln(vdot_j / vdot_i) / ln(ctl_j / ctl_i)`. Return the **median** of the pairs,
clamped `[0.03, 0.20]`; `null` (→ caller uses default `0.06`) with fewer than 2
usable pairs. Median + clamp because single weird pairs (Rivera) must not dominate.
Illustration from the 2026-07-19 backtest notes (implementer: recompute from
`fitness_state`, do not trust these numbers): Rivera 2021 (VDOT 38.9, CTL ≈ 31–35) →
Cartagena 2022 (VDOT 46.0, CTL ≈ 62–66) gives k ≈ ln(1.18)/ln(1.9) ≈ 0.26 → clamps
to 0.20; detraining pairs pull the median down. Small n is exactly why the clamp and
the walk-forward comparison (§3.5) exist.

**Leak-proofing:** inside the backtest, fit k using only observations strictly
before the prediction cutoff. The live path fits on all observations.

### 3.4 The new predictor: `anchored-v1` (`src/deterministic/predictors.ts`)

Same `Predictor` contract as the existing three (`src/backtest/types.ts`):
1. Build observations from `history.priorRaces` (max-effort only — extend
   `RaceSummary` in `src/backtest/types.ts` + `loadRaces()` in
   `src/backtest/history.ts` with the three curation fields).
2. `k = fitBridgeExponent(obs) ?? 0.06`; state = `currentPerformanceState(...)`.
   CTL series: predictors currently rebuild Banister in-memory from
   `history.activities` (`runningCtl()` helper) — reuse it for `ctlAtObservation`
   and `ctlNow`; do NOT read `fitness_state` inside predictors (it postdates the
   cutoff → leak).
3. Distance conversion via existing `predictTimeS(vdotNow, distanceM)`; keep the
   Riegel-exponent trait fit (`fitRiegelExponent`) restricted to max-effort races.
4. Terrain: unchanged (`courseFactor` + `TRAIL_SURFACE_FACTOR`).
5. `note`: must carry provenance — anchor name/date, staleness, k, ctl ratio.
   Example: `anchor Medellín HM 2022-09-04 (1391d stale) · k=0.06 · CTL 54→8`.

Keep the three old predictors registered — the backtest report comparing all four IS
the acceptance evidence.

### 3.5 Freshness-aware calibration (fixes D2)

New pure module `src/backtest/calibration.ts`:

```ts
export interface CalibratedError { errorPct: number; stalenessDays: number; ctlShift: number }
export type FreshnessBucket = "fresh" | "stale";
export function bucketOf(stalenessDays: number, ctlShift: number): FreshnessBucket
// fresh ⇔ stalenessDays ≤ 120 && ctlShift ≤ 0.35
export function intervalFor(
  errors: CalibratedError[], bucket: FreshnessBucket, confidence: "high"|"medium"|"low",
): { p10Pct: number; p90Pct: number; n: number; pooled: boolean }
```

- Interval = P10/P90 of same-bucket errors when that bucket has ≥ 3 samples;
  otherwise pooled errors **widened ×1.25** and flagged `pooled: true`.
- Anchor-confidence widening: `low` ×1.30, `medium` ×1.10, `high` ×1.00 (applied to
  both tails). Constants live in one exported object; tests pin them.
- Wire-up: backtest (`src/backtest/run.ts`) records `staleness_days` and `ctl_shift`
  per prediction into `prediction_log.context` (predictors return them via a
  structured field — extend `PredictionResult` with optional
  `diagnostics?: { stalenessDays: number; ctlShift: number }`; report prints them).
  `live.ts` replaces `backtestErrors()` quantiles with `intervalFor(...)` using the
  live prediction's own bucket, and stores bucket + n + pooled in context.
- **Backtest report** (`src/backtest/report.ts`): per-predictor summary gains a
  per-bucket breakdown (`fresh: n=3 MAE 1.7% · stale: n=4 MAE 21%` shape) and the S1
  line becomes two lines: overall MAE (context) and **fresh-bucket max-effort MAE —
  the deployable claim the <3% gate applies to**.

### 3.6 The race-day forecast (fixes D3)

New pure module `src/deterministic/forecast.ts` + CLI `npm run forecast`
(`src/predict/forecastCli.ts`):

```ts
export type Scenario = "plan" | "reduced" | "maintain";
export interface ForecastInput {
  state: PerformanceState; k: number;
  currentRunningCtl: number; currentWeekKm: number | null;
  weeksToRace: number;
  calibration: CalibratedError[];
}
export interface ScenarioForecast {
  scenario: Scenario; projectedCtl: number; projectedVdot: number;
  timeS: number; p10S: number; p90S: number;
}
export function forecastRaceDay(x: ForecastInput): ScenarioForecast[]
```

CTL projection: reuse the **actual planning controller**, not a parallel model —
iterate `plannedRunVolumeCeiling` / `runningProgressionFactor`
(`src/deterministic/weekTemplate.ts`) week by week to race day, convert weekly km to
daily stress via the pace-based stress function (`activityStress`, method "pace")
at observed easy pace, roll Banister forward (`banisterSeries` continuation — note
it starts from 0; carry state manually as in the controller's own EWMA, pattern
exists in the 24-week simulation described in repo memory). Scenario adherence:
`plan` = 100% of prescribed km with PROGRESS granted each compliant week (the
optimistic-but-plausible path), `reduced` = 70% of prescribed km with PROCEED-only
progression (×1.0), `maintain` = current week's km flat forever. Taper handled by
`trainingPhase` reaching `taper`.
Then: `projectedVdot = vdotNow × (max(projCtl,5)/max(ctlNow,5))**k` → course model →
per-scenario time; intervals via §3.5 using the anchor staleness **as of race day**
(anchor now + ~9 months = stale bucket, honestly wide) unless a planned milestone
(§ below) is marked — the CLI prints, per scenario, time + band + one-line driver.

Persist to `prediction_log` with `context.estimate_kind = 'race_day_forecast'`,
`context.scenario`, `context.anchor`, `interval_*` columns as usual. The trajectory
page can chart these later — **UI is a separate second PR**; this spec's DoD is CLI +
persistence only.

**Milestones:** the forecast output must state, in text, the single highest-value
uncertainty-reduction action: *"a maximal 5K/10K test after N consistent pain-free
weeks re-anchors the model; until one lands, April's band stays wide."* Gate wording
on the P0 check-in (consistent pain-free weeks), don't invent a scheduler.

## 4. What this deliberately does NOT change

- Banister/stress/zones/minetti/riegel/vdot modules: untouched.
- The plan generator and review controller: untouched (P0's territory).
- `current_shape` remains the dashboard headline; forecast is additive.
- No ML, no new dependencies, no LLM anywhere in this pipeline, no Garmin.
- Training-derived anchors (mining streams for max efforts — the real fix for anchor
  droughts) = **P1.5, separate spec**; leave a seam: `PerformanceObservation` is
  already source-agnostic (nothing in it says "race").

## 5. Test plan (all pure-function; no DB in tests)

`performanceState.test.ts`: anchor picks most-recent not best-ever (regression for
D1, use the real shape: 2019 VDOT 48.6 vs 2022 VDOT 46.0 → anchor must be 2022);
90-day/confidence tiebreak; bridge floors; k-fit median + clamp + null on <2 pairs;
leak-free subset behavior.
`calibration.test.ts`: bucket boundaries (120d/0.35 edges); ≥3-sample bucket beats
pooled; widening factors pinned; pooled flag.
`forecast.test.ts`: monotonicity property `plan ≥ reduced ≥ maintain` in projected
CTL and ≤ in time; maintain-scenario with zero running → time degrades vs today;
taper applied; determinism (same input → same output).
`predictors` additions in `models.test.ts` or new file: `anchored-v1` note carries
provenance; max-effort filtering excludes flagged races.
`racesCsv.test.ts`: new columns parse + default; reject bad enum values.
Report test: per-bucket lines render; S1 line reads on fresh bucket.

## 6. Verification runbook

```bash
npm run migrate                        # applies 006
# Juan confirms curation flags, then:
npm run races:import -- races.csv
npm run backtest                       # expect: 4 predictors; anchored-v1 fresh-bucket
                                       # MAE ≤ vdot-ctl-v1's; per-bucket breakdown printed
npm run predict                        # provenance line shows a 2022 anchor, NOT the 2019 10K
npm run forecast                       # three scenarios, honest wide bands, milestone note
npm run typecheck && npm test
```

Acceptance on the backtest is comparative and honest: `anchored-v1` must beat or
match `vdot-ctl-v1` on fresh-bucket MAE and must not catastrophically regress the
stale bucket; if it loses, the finding is reported, not hidden — the backtest is the
judge (PROJECT.md F2 gate still governs).

## 7. Definition of done

1. Typecheck + full suite green; migration 006 applied; races curated (Juan's
   confirmations in `races.csv`).
2. `npm run predict` anchors on the most recent max-effort race with provenance in
   both the log line and `prediction_log.context`.
3. Backtest prints per-bucket calibration; S1 claim restated on the fresh bucket.
4. `npm run forecast` produces three persisted scenario forecasts with intervals and
   the milestone note.
5. UI copy unchanged except where it already says "current shape" (no new UI).
6. `NEXT_STEPS.md` P1 section updated to point at what shipped and what remains
   (UI fan chart, P1.5 training-derived anchors).
