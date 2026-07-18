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

**Not started:** F1 (deterministic layer) — the critical path. Everything else waits on it.

## 2. The critical path, in order

```
F1 (hand-written)  ->  F2 backtest GATE  ->  PRD P-A ... P-E
```

**F1 — the AI-free zone. Suggested order (simplest first):**
1. **Riegel** — one formula, immediately testable against the 8 imported races.
   Predict the 2022 half from a 2022 10K and compare. Fastest possible first win.
2. **Banister** CTL/ATL/TSB — answers "what shape am I in today". Needs the
   per-activity stress-score fallback hierarchy (PROJECT.md §6).
3. **VDOT / Daniels** — race time → capacity → training paces.
4. **GAP / Minetti** — do last. Now known to be a *smaller* lever than assumed (see §4).

**F2 is still the gate.** If backtest error is bad, no amount of PRD cleverness saves it.

## 3. Competitive target (new goal: win / podium)

2026 21K results — the benchmark to beat:

| place | time | pace |
|---|---|---|
| 1st M (30-39) | 1:32:36 | ~4:23/km |
| 2nd M | 1:37:14 | ~4:37/km |
| 3rd M | 1:39:24 | ~4:42/km |
| 1st F (30-39) | 1:37:55 | ~4:39/km |

Reference: 2022 peak road halves were **1:38-1:40** (~4:39-4:44/km) — i.e. peak-Juan was at
roughly 2026's 3rd-place pace, *on road*. Trail costs a bit more, so podium = return to peak
**and exceed it**. Winning needs ~5-7 min beyond any time ever run. Honest read: **podium =
stretch but real; win = unlikely in 9 months from current fitness.**

Caveat: one year of data, small field — winning times swing year to year. Worth pulling
2024/2025 winning times to see the actual spread (result portals are JS-based; needs the
browser, not a plain fetch).

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
