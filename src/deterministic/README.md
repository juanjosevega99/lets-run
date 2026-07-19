# Deterministic layer

The math that predicts and validates. **No LLM output feeds these numbers** — the LLM
layer (F3) may call these functions, never the reverse (PROJECT.md §3 still holds).

History note: this directory was originally the hand-written "AI-free zone". That rule
was removed by owner decision on 2026-07-19 (PROJECT.md §9) — Claude wrote these modules
under the compensating controls recorded there: every formula cites its source, every
module carries unit tests against published reference values, and nothing ships without
its F2 backtest error report against real races.

Modules:
- `riegel.ts` — distance extrapolation (Riegel 1981), incl. personal-exponent fitting
- `vdot.ts` — Daniels/Gilbert VO2-based race equivalence + training paces
- `minetti.ts` — energy cost of grade (Minetti et al. 2002), course adjustment
- `stress.ts` — per-activity training stress, PROJECT.md §6 fallback hierarchy
- `banister.ts` — CTL/ATL/TSB impulse-response series
- `limiter.ts` — v1 deterministic limiter heuristic (NOT the full PRD P-A sensitivity
  analysis — that needs dimensions the models don't express yet; see PRD §7 CRUX)
- `validator.ts` — the S2 hard-rule plan validator (inviolable, retries the LLM)
- `predictors.ts` — the composed race predictors registered into the F2 backtest
