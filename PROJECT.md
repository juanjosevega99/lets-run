# PROJECT.md — lets-run (name still soft, see §11)

> Definition doc. If something I'm about to build isn't justified here, it doesn't get built.
>
> **v2 — 2026-07-12.** Folded in first design review: streams-aware schema, explicit
> training-stress input hierarchy, backtest inventory promoted to Task 0, confidence
> interval method closed, DB decision closed (Supabase).

---

## 1. Problem

I have years of training logged in Strava and no serious way to answer two questions:

1. **What shape am I actually in today?**
2. **What time can I run at the Patagonia Running Festival 21K (April 2027)?**

Today the answer is intuition. I want it to be a model with measurable error.

## 2. User

Me. One user. No signup, no multi-tenancy, no onboarding.

If the design gets complicated "in case someone else uses it," that's scope creep — cut it.

## 3. The principle that drives the architecture

**The LLM does not predict race time.**

Race prediction is known, deterministic math. The LLM interprets, plans, and explains — and **calls** those functions as tools.

```mermaid
flowchart LR
    A["your runs<br/><i>Strava history</i>"]
    B["the math — deterministic<br/><i>fitness + race prediction</i><br/>hand-written · F1"]
    C["the coach — LLM<br/><i>weekly plan + explanation</i><br/>F3"]
    D["race day<br/><i>April 2027 · Patagonia 21K</i>"]
    A --> B --> C --> D
    C -. "asks the math, never invents a number" .-> B
```

| Layer | Owner | Why |
|---|---|---|
| Race time prediction | Deterministic code | An LLM invents numbers with a confident tone |
| Load / fatigue metrics | Deterministic code | It's arithmetic, not reasoning |
| Hard training rules | Deterministic code (validator) | They must be inviolable, not "likely" |
| Weekly plan generation | LLM w/ tool calling + structured output | Real value: context, nuance, language |
| Explaining the *why* | LLM | The one thing a human doesn't want to write every week |

Proving I know **where NOT to put AI** is the real goal of this project.

## 4. Success criteria (measurable)

**S1 — Prediction accuracy.**
The system predicts my times in *past* races using only data available before that date.
Target: **mean absolute error < 3%** across my race history.
*(Backtesting: the ground truth already exists in my data. Free.)*
S1 is only meaningful if Task 0 (§8) finds enough races — that's why it runs before any code.

**S2 — Zero hard-rule violations.**
Across N generated plan-weeks, the validator reports **0** violations:

- Weekly volume progression <= 10%
- At least 1 full rest day
- Polarized distribution: >= 75% of volume in low intensity
- No two high-intensity sessions on consecutive days

If the LLM produces a plan that violates a rule, **the system rejects it and retries**. The prompt is not trusted.

**Not** success criteria: looking good, having a chat UI, other people using it.

## 5. Non-goals (explicit)

- Native mobile app / PWA (a plain responsive website opens fine on my phone)
- Multi-user / third-party auth (a single-user password gate to keep my data private once
  deployed is fine — that's a lock, not multi-tenancy)
- General-purpose chat
- Nutrition, sleep, HRV
- Custom domain, scaling, multi-region (one free-tier private deploy for my own access is
  the ceiling — see §11)
- Polished UI (an ugly table is fine)

## 6. Deterministic models to implement

Hand-written. This is the **AI-free zone** (see §9).

- **Riegel** — distance extrapolation: `T2 = T1 * (D2/D1)^1.06`. The 1.06 exponent is the
  literature default; once backtesting works, fit my personal exponent from race pairs.
- **VDOT / Daniels** — race time -> aerobic capacity -> training paces
- **GAP / Minetti** — grade-adjusted pace. **Critical**: my baseline is flat road; Torres del
  Paine is trail with vert. Without this, the prediction is worthless. **Consequence for
  ingestion:** GAP needs per-point distance + altitude streams, not activity summaries.
  The schema stores streams from day one (§7); retrofitting them would mean re-ingesting
  everything.
- **Banister (CTL / ATL / TSB)** — chronic load, acute load, form. CTL/ATL are exponentially
  weighted averages of a **per-activity training stress score**, so every activity must
  resolve to a number via an explicit fallback hierarchy:
  1. HR-based TRIMP, when heart rate stream exists
  2. Pace-based stress from GAP, when only pace/elevation exists
  3. Flat duration-based constant, for everything else (gym, old runs without data)

  The hierarchy is code, not vibes — silent holes in the load curve are worse than crude
  estimates, because they're invisible.

  **Two uses of history (F1 design — noted here so it isn't lost).** Recent load drives
  *current* fitness: CTL's ~42-day time constant means training older than a few months has
  already decayed out of today's form, so a past peak (e.g. 2021–22) does **not** inflate the
  April prediction. The *full* history — especially peak-year *races* — is instead the signal
  for calibrating personal constants (Riegel exponent, VDOT→pace, hill cost) and for
  backtesting. Implication for ingestion: keep all history, never truncate. How wide each
  window is stays an F1 decision.

**Gym:** Strava logs it as a generic activity with no useful metrics. Model it as *non-specific load* (hierarchy level 3): it affects fatigue (ATL), it does not add running fitness (running CTL). Don't invent more than the data supports.

## 7. Minimum architecture

```
Strava bulk export ──► Ingestion (backfill) ──► Postgres (Supabase)
Strava API ─────────► Ingestion (incremental) ──►   ├── activities   (normalized summaries)
                                                    ├── activity_streams (time/distance/altitude/HR arrays)
                                                    └── races         (manual: official times, terrain — the backtest set)
                                │
                                ├──► Deterministic layer (metrics, prediction, validator)
                                │            ▲
                                │            │ tool calling
                                └──► LLM layer (weekly plan + explanation)
                                             │
                                             ▼
                                       Evals / backtesting
```

Stack: TypeScript + Node, Postgres on **Supabase** (works without my Mac running; free tier),
Anthropic SDK. No heavy framework until it hurts — plain SQL migrations, no ORM.

## 8. Phases

| Phase | Deliverable | Done when |
|---|---|---|
| **T0** | Race inventory (**no code**) | List of past races with reliable official times, distance, terrain. This defines the backtest set size — and whether S1 is even measurable. An afternoon with Strava history + results sites |
| **F0a** | Backfill ingestion | Strava bulk export (CSV + GPX/FIT) parsed into Postgres, streams included |
| **F0b** | Incremental sync | Strava OAuth + API pulls new activities; rate limits handled. Only needed for "what shape am I in *today*" — can lag F1/F2 |
| **F1** | Deterministic layer | Pure functions + unit tests. Still zero LLM code in the repo |
| **F2** | Backtesting | Error report across past races. **This is where I find out if the project holds up** |
| **F2.5** | Readout page (**no LLM**) | One ugly static page: fitness curve + backtest results + today's prediction. Makes the data tangible *before* any LLM work. Only justified because it reuses F1/F2 output verbatim and adds zero domain logic |
| **F3** | LLM layer | Weekly plan as a typed structured output, tool-calling into F1 |
| **F4** | Evals | Golden set (~30 cases) + hard-rule validator + LLM-as-judge for explanation quality |
| **F5** | Minimal UI | Simple **hosted, auth-gated website** (not PWA, not native): current fitness, prediction, this week's plan. Server reads Supabase; a single-user password gate keeps data private. A read-only view (data profile, coverage, history, races) can land earlier as F2.5 |

**F2 is the gate.** If the error is 15%, a better prompt won't fix it — rethink the model or kill the project. Knowing that early is the senior part.

**On F2.5 and §5.** §5 lists "polished UI" as a non-goal, and that still holds. F2.5 is not that: it's a read-only page that renders numbers F2 already computed, so I can *see* the fitness curve and prediction interval before investing in the LLM layer. The rule that keeps it honest: if I catch myself adding a form, a button that changes data, or any logic that isn't already in F1/F2, I've crossed into building a product and I stop.

## 9. Process rules (anti-atrophy)

This project exists as much to **stop outsourcing my thinking** as it does to learn AI.

> **AMENDED 2026-07-19 (owner decision):** the AI-free zone is **removed**. With ~9 months
> to race day, shipping a working v1.0 beats the hand-writing exercise — the training
> clock outranks the learning clock. Claude now writes the deterministic layer too, with
> the compensating controls below. Original rule kept for the record:
> ~~AI-free zone: domain design and the entire deterministic layer (F1) get written by
> hand, autocomplete off. AI may critique my code; it does not produce it there.~~

- **Compensating controls, since AI writes the math now:** every model cites its source
  formula in comments; every module has unit tests against published reference values;
  and the F2 backtest remains the only judge that matters — no model ships to the
  dashboard without its error report against my real races.
- Weekly: 30 min writing what I learned and what I decided, in `DECISIONS.md` (in English).

## 10. Risks

- **Not enough trail data.** Almost all my history is road/other sports -> the Torres del Paine prediction carries high uncertainty. *Mitigation: report intervals, not a single number (see §11 — closed).*
- **Small backtest set.** If T0 finds only a handful of reliable races, MAE < 3% is statistically thin. *Mitigation: T0 runs first; if the set is small, widen it with honest proxies (parkruns, timed segments) or lower confidence claims accordingly.*
- **Strava API limits.** Rate limits and scopes may stall ingestion. *Mitigation: bulk data export owns the historical backfill (F0a); the API is only incremental sync (F0b).*
- **Supabase free tier pauses after ~1 week of inactivity.** *Mitigation: acceptable for a personal project — resume takes seconds; revisit if it gets annoying.*
- **Over-engineering the LLM layer.** The symptom will be me starting to build a chat. *Mitigation: re-read §5.*

## 11. Decisions

**Closed:**
- [x] Postgres: **Supabase** (managed; doesn't depend on my Mac running Docker).
- [x] Confidence interval: **empirical quantiles of backtest errors**. Run the backtest,
      collect the error distribution, report the point estimate with P10–P90 of historical
      errors around it. No parametric assumptions; directly reuses F2.
- [x] How I use it: **a simple hosted, auth-gated website — not a CLI, not a PWA, not native.**
      No offline/push need, so a PWA is pure overhead. Server-side reads Supabase (the DB
      secret can't live in the browser); a single-user password gate keeps my data private.
      Full dashboard waits for F1/F2; a read-only data view can come first (F2.5).

**Open:**
- [ ] Name. Working name `lets-run`; note that letsrun.com is a famous running forum, so the
      final name should probably diverge. Rename is cheap — don't block on it.
- [ ] Which past races have reliable official times? -> **T0, the first task.**
