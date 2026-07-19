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

## 3. Pending on Juan

- [ ] **ANTHROPIC_API_KEY in `.env`** (console.anthropic.com) — the only missing piece for
      `npm run plan`. Everything deterministic already runs without it.
- [ ] **Start running.** aerobic_base, says your own model.
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
