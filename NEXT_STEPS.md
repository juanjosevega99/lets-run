# NEXT_STEPS.md — resume here

Rewritten 2026-07-19 after the v1.0 build session (AI-free zone removed by owner decision —
PROJECT.md §9). **The app exists.** Everything below reflects what actually runs.

## 0. The clock

**Race: 24 April 2027 — ~9 months.** The model says it plainly now: running CTL **0.6** vs
your 2022 peak of **70.6** (1%). Limiter: aerobic_base. The code is no longer the
bottleneck; the training is.

## 1. What v1.0 does (all verified end-to-end)

| Command | What it does |
|---|---|
| `npm run strava:sync` | Pull new activities from Strava (F0b) |
| `npm run fitness:rebuild` | Stress hierarchy → Banister CTL/ATL/TSB → fitness_state (3003 days) |
| `npm run backtest` | F2: all predictors vs the 8 races, leak-proof cutoffs, MAE report |
| `npm run predict` | Live race prediction + empirical P10–P90 interval → prediction_log |
| `npm run plan` | F3: limiter → LLM week plan → S2 validator gate (retry ≤3) → plan_week |
| `npm run plan:free` | **Zero-cost alternative to `plan`** — same limiter/fitness inputs, fixed percentage-split templates instead of an LLM call (`src/deterministic/weekTemplate.ts`), same S2 validator (self-satisfies by construction, checked as a hard assertion). No API key ever needed. |
| `npm run tomorrow` | Zero-cost single-day suggestion (not a full week) — for a quick check without generating/persisting a plan |
| `npm run web` | Dashboard: Now / This week / Trajectory on live data |

Deterministic layer (`src/deterministic/`): Riegel (+ personal exponent fit), VDOT
(Daniels/Gilbert), Minetti GAP + course factor, stress hierarchy (TRIMP→pace→flat),
Banister, S2 validator, limiter heuristic v1, three composed predictors. Every formula
source-cited; 116 tests incl. published reference values.

## 2. Backtest verdict (the honest read)

Overall MAE: riegel 16.7% / vdot 15.2% / **vdot-ctl 13.7%** (best; its CTL detraining
adjustment halved the Cartagena error). S1 (<3%) not met overall — **but the error splits
cleanly**: with a fresh, max-effort reference race (the 2022 cluster incl. the trail half at
−1.9% via linked 383m gain + Minetti), the last-3 MAE ≈ **1.7% — S1-passing**. The big misses
are answer-key problems: the 2018 mountain 2:09 as reference, the paced sister 5K, a stale
reference across the 2021→2022 fitness surge.

Today's prediction: **1:48:37** (1:27–2:07), gap to target **11:23**. Wide interval = honest
(it inherits the polluted error distribution).

## 2.5 Pace prescription bug — FIXED 2026-07-19

Juan caught this: the plan prescribed "easy 5:14/km", which for him today would be ~170+ bpm
(84%+ of max 201) — threshold effort, not easy. Cause: training paces came from **best-ever
VDOT 48.6** (a 2019 10K) while CTL is 0.6. The race predictor already applies a CTL detraining
adjustment; pace prescription did not.

Evidence from his own data — same HR, ~1:40/km slower now:

| era | pace | avg HR |
|---|---|---|
| 2022 peak | 5:35–5:46/km | 144–157 |
| 2026 now | 7:09–7:28/km | 148–155 |

Fix: `src/deterministic/zones.ts` (Daniels HR bands: easy 65–79% HRmax → ceiling **159 bpm**)
plus **observed-pace estimation** in `plan/context.ts` — median pace of runs in the last 180
days actually run under the easy HR ceiling. Easy pace went **5:14 → 7:20/km**, `paceSource`
flipped `vdot` → `observed`. Sessions now lead with the HR ceiling ("HR governs — slow down or
walk to stay under") and demote pace to a guide. HR is self-normalizing to current fitness;
a pace derived from past fitness is not. The LLM prompt carries the ceiling + pace provenance
too, so `npm run plan` can't over-prescribe either.

**Remaining gap:** `thresholdSecPerKm` is still peak-VDOT-derived. Harmless today (aerobic_base
weeks contain no threshold work) but must be fixed before the limiter reaches `threshold`.

## 2.6 Dashboard actions — CLI/web split CLOSED 2026-07-19

`POST /actions/refresh` runs sync → fitness → plan in one call (~8s), driven by a
**Sync & replan** button in the dashboard header. CLIs and the button share the exact
same code: `src/strava/sync.ts`, `src/fitness/rebuild.ts`, `src/plan/freePlan.ts` each
export a core function taking `(sql, log)`; the `*Cli.ts` files are thin wrappers.
Orchestration in `src/pipeline/refresh.ts`. POST-only (a stray GET can't mutate data),
single-flight guard against concurrent runs, per-step failure isolation. All UI hints
now point at the button rather than npm commands.

**Still CLI-only** (intentionally — rare/one-off): `backtest`, `predict`, `plan` (LLM),
`ingest:export`, `races:import`, `races:link`, `strava:auth`, `migrate`.

## 2.7 How the model decides a week (analysis, 2026-07-19)

Chain: **fitness_state (Banister) → limiter → volume → template → validator**.

1. `findLimiter()`, priority-ordered: CTL < 60% of peak → `aerobic_base`; longest run
   < 60% of race distance → `long_endurance`; quality share < 8% → `threshold`; else
   `race_specific`.
2. Volume: `previousWeekKm × progression`, where progression is fatigue-aware —
   TSB < −20 → ×1.0 (flat), TSB < −10 → ×1.05, else ×1.10.
3. Template: base/long-endurance → all-easy (30% long run); threshold/race-specific →
   one high day (18%) + long run (28%).
4. S2 validator gates it; a failure is a template bug, not something to patch around.

**24-week projection if he follows every week** (simulated): 12 → 33 km/wk, CTL 0.6 →
41.9, TSB self-stabilizes ≈ −10 to −12 (the fatigue-aware progression naturally throttles
to ×1.05). Limiter stays `aerobic_base` the whole time — it flips at CTL > 42.4 (60% of
peak 70.6), i.e. **around week 25**. That's coherent coaching (rebuild base first), not a
bug — but it means the plan's *character* won't change for ~6 months.

**Two real gaps found:**
- **`qualityShare28d` is hardcoded to `1`** in `plan/context.ts`, so the `threshold`
  limiter can *never* fire. The progression will jump `long_endurance` → `race_specific`,
  skipping a threshold block entirely. Needs per-session intensity classification.
- **PRD F-B (the control loop) is not built.** Week-to-week adaptation today is
  *implicit only* — via actual logged volume (`previousWeekKm`) and actual fatigue (TSB).
  The system does **not** compare planned vs actual, does not compute compliance, does not
  know whether a missed session was the KEY one or a filler, and never writes `week_review`
  (table exists, unused). No PROGRESS/REPEAT/DELOAD decision exists. **This is the single
  biggest gap between the app and the PRD.**

## 3. Pending on Juan

- [ ] **First real week is live** (`npm run plan:free`, week of 2026-07-20): 12km total,
      5 easy runs + Sunday long run, held flat (not +10%) because TSB was -29.5 from two
      long weekend rides. **Start running.** aerobic_base, says your own model.
- [ ] **ANTHROPIC_API_KEY in `.env`** (console.anthropic.com) — optional, not required.
      Only needed for `npm run plan` (LLM-phrased weeks with narrative explanation).
      `npm run plan:free` is the permanent zero-cost path and is what's running now.
- [ ] **T0 curation:** decide whether "Carrera de la mujer 5k" (paced, not max effort) stays
      in the answer key; consider an `is_max_effort` flag. Improves the interval immediately.
- [ ] Commit the working tree (~24 files). Then deploy web for phone access (host + the
      already-built `DASHBOARD_PASSWORD` gate).

## 4. v1.1 (deliberately not in v1.0)

- **F-B control loop** (PRD P-C): needs lived plan weeks to compare against — build after
  2-3 weeks of real plan+execution data. Schema (`week_review`) already exists.
- **Training-derived reference efforts:** mine streams for max-effort segments so predictions
  don't depend on stale races (fixes the Cartagena-class error for good).
- **Real P-A sensitivity analysis:** still gated on the PRD §7 CRUX (model dimensions).
  The limiter heuristic v1 (documented in `src/deterministic/limiter.ts`) stands in.
- **Weekly automation:** cron for sync→rebuild→predict→plan (worth doing once a plan-week
  habit exists).

## 5. Course + target facts (settled)

21K at 20–100m elevation, net downhill, ~250m gain assumed for prediction (override:
`npm run predict -- --gain N`). Target: **win Varones 18-29, sub-1:37:14** (2026: 1st 1:37:14,
then 1:59:08 — thin bracket, high variance). Trail surface factor 1.04 in predictors.
