# NEXT_STEPS.md — resume here

Working notes. Not permanent like `PROJECT.md` / `PRD.md` — rewrite freely.
Rewritten 2026-07-18 (supersedes the 2026-07-16 version; everything it listed is now resolved).

## 0. The clock

**Race: 24 April 2027. That is ~9 months out.** Base building should start now — the
software is not the bottleneck, the training is. A 9-month runway from a detrained base is
enough for a strong podium attempt, not enough to bank on winning (see §3).

## 1. Where things actually stand

**Done — data layer is complete and rich:**
- F0a bulk export ingestion: 1818 activities, 2018-04-30 → 2026-07-11
- F0b Strava API incremental sync (OAuth + watermark) — built, verified live
- TCX parser (`src/ingest/tcx.ts`) — this was the big unlock. Stream coverage went
  **50% → 92%**, HR **33% → 75%**, elevation **42% → 78%**. Recovered 492 runs including
  ~294 of the 380 peak 2021-22 runs (2021 running was ~100% TCX, previously stream-less).
- T0 race inventory: **8 races imported**. NOTE: times are Strava moving times accepted as
  close-enough, not official chip times (~1-2 min noise in the answer key — remember this
  when reading F2's error).
- `npm run profile` — read-only coverage report
- `npm run web` → localhost:3000 — thin read-only dashboard (F2.5 seed)
- PROJECT.md decisions closed: Supabase; empirical-quantile confidence intervals;
  simple hosted auth-gated website (not PWA/native)

**Built 2026-07-18 (the "everything around the F1 hole" session):**
- **PRD §4 data model** — migration 003: `fitness_state`, `plan_week`, `week_review`,
  `prediction_log` (dimension columns nullable pending the PRD §7 CRUX).
- **F2 backtest harness** (`src/backtest/`) — `npm run backtest`. Feeds each registered
  predictor only pre-race data (leak-proof cutoff), scores vs official times, prints
  per-race error + MAE vs the S1 <3% target + empirical error quantiles, persists every
  prediction to `prediction_log`. Registry (`src/backtest/registry.ts`) is empty on
  purpose — F1 plugs in there.
- **Dashboard v2** (`npm run web`) — the PRD's three screens on live data: *Now*
  (countdown, bracket target + benchmarks, prediction slot w/ gap-to-target, last-28-days
  raw training), *This week* (logged vs planned), *Trajectory* (52 zero-filled weeks vs
  the 2021-22 avg reference — 28 of the last 52 weeks are zero running; the chart shows
  it honestly). Optional `DASHBOARD_PASSWORD` basic-auth gate (deploy prerequisite, §11).
- 73 tests passing; verified live end-to-end (auth 401s, all routes, real data).

**Not started:** F1 — still the critical path, still hand-written.

## 2. The critical path, in order

```
F1 (hand-written)  ->  register in src/backtest/registry.ts  ->  npm run backtest  ->  GATE  ->  PRD P-A...
```

**F1 — the AI-free zone. Suggested order (simplest first):**
1. **Riegel** — one formula. Implement the harness's `Predictor` contract
   (`src/backtest/types.ts` — reshape that contract freely if your design wants a
   different shape; it's a socket, not a spec), register it, `npm run backtest`, and the
   error report + dashboard prediction slot light up the same minute.
2. **Banister** CTL/ATL/TSB — "what shape am I in today". Needs the stress-score
   fallback hierarchy (PROJECT.md §6). Writes `fitness_state` rows (a thin rebuild
   runner is AI-OK plumbing — ask when ready).
3. **VDOT / Daniels** — race time → capacity → training paces.
4. **GAP / Minetti** — do last; smaller lever than assumed (see §4).

**F2 is still the gate.** If backtest error is bad, no amount of PRD cleverness saves it.

## 3. Competitive target — WIN THE 18-29 BRACKET

Category: **Varones 18-29** (born 1999 → 28 on 31 Dec 2027, the event's age-reference date).
The bracket is thin, which makes the goal far more attainable than the overall times suggest.

2026 21K, Varones 18-29 (163 finishers overall):

| cat. place | time | note |
|---|---|---|
| **1st** | **1:37:14** | Elian Tornikoski — also 2nd overall |
| 2nd | 1:59:08 | **22-minute gap** back to 1st |
| 3rd | 2:00:15 | |

Overall reference: 1st 1:32:36 (30-39), 3rd overall 1:39:24.

Reference: 2022 peak road halves were **1:38-1:40**, at **age 23**. At 28 he's entering prime
endurance years. Honest read:
- **Category podium (~sub-2:00): very likely**, even well short of peak.
- **Category win (~sub-1:37): a realistic 9-month goal** — peak-Juan was within ~2 min of it.
- Overall podium (~1:39) = stretch. Overall win (1:32:36) = not the plan.

**Risk:** thin bracket, high variance — the 1:37 was one outlier, the rest of the bracket was
1:59+. Train for **sub-1:37**, not for last year's field. Worth pulling 2024/2025 18-29 times
to see the real spread (JS portals — use the browser, not a plain fetch).

## 4. Course reality (settled — stop re-litigating)

Official 21K altimetry: runs at **20-100 m above sea level**, aid stations labelled 30 m /
23 m / 22 m, start ~50 m → finish 22 m (net slightly downhill), two modest ~50-70 m bumps.
Torres del Paine valley floor, far-south Patagonia — near sea level despite being in Chile.

Consequences:
- **No altitude/oxygen correction.** Don't build it. Sea level.
- **GAP matters less than assumed.** Real but modest; not a mountain course.
- **The genuine uncertainty is surface + wind** (gravel, river crossings, Patagonian wind),
  which the models can't see. That belongs in a wider prediction interval, not a new model.

## 5. PRD gaps to resolve (before P-A)

- [ ] **F-A has no dimensions to analyse.** The sensitivity loop iterates over
      `{aerobic_base, threshold, grade_durability}`, but Riegel (time→time), VDOT (a single
      scalar) and Banister (load/fitness/fatigue) produce *none* of those as separable
      parameters. As planned, `f(state)` is scalar-in/scalar-out. Either extend the model to
      express separable dimensions (e.g. critical-speed splitting aerobic vs anaerobic, plus
      an explicit grade term) or scope F-A to what the math can actually express.
      **This is the crux, and it's AI-free-zone work.**
- [ ] PRD §1 expects grade-durability to be a big early limiter — §4 above says otherwise.
      Rewrite that expectation.
- [ ] PRD has no **target time / gap-to-podium** concept. Add it: the *Now* screen should
      show predicted time *against the target*, and F-A's ROI is sharper when it's closing a
      measurable gap.
- [ ] `training_cost` unit (PRD §7) — must be commensurable across dimensions or the ROI
      comparison is apples-to-oranges.
- [ ] Age category? Determines whether the realistic target is overall podium or age-group
      podium (the 2026 overall winner was in 30-39, so that bracket is competitive).

## 6. Housekeeping

- **Nothing committed since `d173a64`.** `PRD.md` is untracked; the TCX parser, web view and
  PROJECT.md updates are committed. Commit `PRD.md` when ready.
- Deploying the web dashboard for phone access still needs: a host (Vercel free tier) + a
  single-user password gate (PROJECT.md §11). Not urgent.
- Garmin (PRD §2): partly answered already — the Strava export yielded 92% stream coverage
  with 75% HR, so the marginal value of Garmin's richer streams is **lower than assumed**.
  Confirm what's genuinely missing before spending a weekend on it.
- `races.csv` gotcha: notes fields must avoid commas and double-quotes or csv-parse rejects
  the row.
