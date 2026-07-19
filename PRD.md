# PRD — Adaptive Race Coach (name TBD)

> Product requirements. `PROJECT.md` says *why* and *what not to build*. This says *what the product does* — feature by feature, flow by flow. Read them together; where they conflict, this doc wins because it's newer.
>
> **Reconcile before building:** parts of this may already exist. Mark done, delete superseded, keep the rest.

---

## 0. One-line product

> A single-user coach that looks at my real training history, tells me the shape I'm in, predicts my Patagonia 21K time with honest uncertainty, and every week prescribes the **one workout that improves that prediction the most** — then adapts as I actually execute.

The shift from `PROJECT.md`: it's no longer a predictor with a plan attached. The prediction is the *engine*; the product is the **weekly decision** it drives.

### The target (added 2026-07-18, refined with category data)

Not just "a predicted time" — a **gap to a number that matters**.

I race **Varones 18-29** (born 1999 → 28 on 31 Dec 2027, the event's age-reference date).
That bracket is *thin*, and it changes the goal. 2026 21K, my category:

| target | time | note |
|---|---|---|
| **Win 18-29** | **1:37:14** | Elian Tornikoski — also 2nd overall |
| 2nd 18-29 | 1:59:08 | 22-minute gap back to 1st |
| 3rd 18-29 | 2:00:15 | |

Overall reference: 1st 1:32:36 (30-39 bracket), 3rd overall 1:39:24. 163 finishers.

**Goal: win my category (~sub-1:37).** My 2022 peak road halves were 1:38-1:40 — within a
couple of minutes of the bracket win — and that was at **age 23**; at 28 I'm entering prime
endurance years, not leaving them. **Category podium (~sub-2:00) is very likely** even well
short of peak. Overall podium (~1:39) is the stretch; overall win (1:32:36) is not the plan.

**Risk — thin bracket, high variance.** That 1:37:14 was a single outlier; the rest of the
bracket was 1:59+. If two fast under-30s enter in 2027 the bar jumps. **Train for sub-1:37,
not for last year's field.**

**Product consequence:** every prediction is shown **against the target**, and F-A's ROI is
measured as *gap closed*, not vague improvement.

---

## 1. The three features that make this "cool"

Everything else is plumbing. These are the reasons the project is worth building.

### F-A · Highest-ROI workout ("the least, but the most improvement")

**The idea:** given my current fitness and the specific race, find the single training dimension that — if improved by a *realistic* weekly amount — drops my predicted race time the most. Prescribe the workout that develops that dimension. That's this week's key session. Everything else is support volume.

**Why it's not an LLM job:** the predictor is already a function `f(fitness_state) → race_time`. This feature is **sensitivity analysis on f**:

```
for each dimension d in {aerobic_base, threshold, grade_durability, ...}:
    delta_d   = realistic weekly improvement in d
    time_gain = f(state) - f(state with d += delta_d)
    roi_d     = time_gain / training_cost(delta_d)   # cost in stress/time
limiter = argmax(roi_d)
```

The limiter is pure math off the model I already have. The LLM's job starts *after*: map `limiter → workout type`, write the session, explain why in one paragraph. Deterministic decides *what*; LLM phrases *how*.

**Expected behavior for my case** (road base, ~9 months out, currently detrained) — the model should *discover*, not be told: early on **aerobic base** should dominate (I'm rebuilding from near-zero running); mid-cycle, threshold; late, race-specific efforts.

**Corrected 2026-07-18 — grade-durability is a *minor* lever here, not a major one.** The official altimetry shows the 21K running at 20-100 m above sea level, net slightly downhill, with two modest ~50-70 m bumps (`NEXT_STEPS.md` §4). It's a fast, low, rolling course — won in 1:32:36 (~4:23/km), which is only possible on gentle terrain. I also have almost no trail data to fit a grade term from. So: don't let the model over-weight a dimension the course doesn't demand and my data can't estimate. If it surfaces *that* from my own data, the feature works.

**Acceptance:**
- Given a fitness state, the system names one limiter and one key workout, with the predicted time-gain attached (e.g. "this week's key session targets threshold; modeled effect −0:38 on race time").
- The limiter is reproducible and explainable from the numbers — not vibes from the LLM.

### F-B · Adaptive weekly replanning (the control loop)

**The idea:** the plan reacts to reality. Nail the week → progress. Miss it → reassess. Dig too deep a hole → back off. This is the "train super well, give me the harder second week" thing, made into a controller.

**Mechanism (deterministic decision, LLM narration):**

```
1. Ingest actual week (already have ingestion)
2. Compute: compliance %, planned vs actual load, resulting CTL/ATL/TSB movement, red flags
3. Decide:
     high compliance + recovery in range   -> PROGRESS (overload limiter or move to next limiter)
     missed the KEY (limiter) session       -> REPEAT / adjust the week
     missed only filler                     -> PROCEED
     fatigue red flag (TSB too negative)    -> DELOAD
4. LLM explains the decision in plain language
```

The distinction that makes this smart: **not all missed sessions are equal.** Skipping the key limiter session changes next week; skipping an easy shakeout doesn't. The system knows which session was load-bearing because F-A tagged it.

**Acceptance:**
- Feeding in a "perfect week" vs a "missed key session" week vs a "over-fatigued" week produces three *different, correct* next-week decisions.
- Every decision cites the numbers that drove it (compliance, TSB, which session was the key one).

### F-C · Apple-grade frontend

**The idea:** the dashboard should feel like an Apple product page — generous space, strong type, restrained palette, a few big beautiful data views, calm motion. Not a dense analytics cockpit.

**The tension, named:** `PROJECT.md` §5 said "an ugly table is fine," on purpose, to stop me polishing instead of building. That guardrail still holds — **polish is earned after F-A and F-B work, not before.** This section is a *target*, gated behind the engine. If I catch myself picking fonts before the control loop makes correct decisions, I've lost the plot (see `PROJECT.md` §9).

**Core screens (v1, three of them, no more):**
1. **Now** — current fitness, form (TSB), and the predicted 21K time with its uncertainty band, **shown against the podium target with the remaining gap**. The hero screen.
2. **This week** — the key workout (F-A) front and center, support sessions secondary, one paragraph of *why*.
3. **Trajectory** — fitness over time and predicted-time-over-time, converging (or not) on the goal. The "am I on track" view.

**Acceptance:** a stranger glancing at *Now* understands "he's in X shape, aiming for Y, currently projected Z" in five seconds, and it looks like something I'd want to open every morning.

---

## 2. Garmin sync (later — and honest about it)

Worth it because Garmin has richer streams than what survives the trip into Strava (HR detail, running dynamics, etc.).

**Reality check before you sink a weekend into it:** Garmin's direct developer API is partner-gated, not a casual OAuth like Strava. The pragmatic paths, in order:
1. **You may already have Garmin data** — Garmin auto-pushes activities to Strava, so your existing Strava ingestion likely *is* your Garmin data, minus the richest streams. Confirm what's actually missing before building anything.
2. If you need the richer streams, the common personal-project route is an **unofficial Garmin Connect library** (community-maintained). Understand the fragility/ToS tradeoff before committing.
3. Official partner API only if this ever stops being a toy.

**Verify current access at build time** — this area changes, and I'd rather you check than trust a stale claim. Treat Garmin as a *data-quality upgrade to an existing pipeline*, not a new pillar. Don't let it block F-A/F-B.

---

## 3. User stories

- *As me, on Monday,* I open **Now** and see my current fitness, form, and projected 21K time with an honest range.
- *As me, planning the week,* I see the one key workout that matters most and why, without reading a training manual.
- *As me, after a great week,* the plan steps up instead of repeating.
- *As me, after a week I bailed on,* the plan asks whether the thing I skipped actually mattered, and only reshuffles if it did.
- *As me, chasing the podium,* I see my projected time next to the podium target and how much gap is left — so every week has a concrete number to move.
- *As me, over months,* I watch the predicted time trend toward the goal and know whether I'm on track or need to change something.
- *As me, curious,* I can ask "why this workout?" and get the real reason (the limiter + the modeled time-gain), not a horoscope.

---

## 4. Data model additions (beyond current ingestion)

- **fitness_state snapshots** — per day: CTL, ATL, TSB, threshold estimate, aerobic estimate, grade-durability estimate. This is what F-A runs on and F-C's *Trajectory* renders.
- **plan_week** — the prescribed week: key session (with target limiter + modeled time-gain), support sessions, generated-at, model version.
- **week_review** — planned vs actual: compliance, load delta, resulting state movement, the decision taken, and the LLM's explanation. This is the audit trail that makes F-B trustworthy.
- **prediction_log** — every prediction with the data-cutoff date, so backtesting (`PROJECT.md` F2/S1) stays honest.

---

## 5. Phasing (layers onto what exists — adjust to reality)

| Phase | Builds | Done when |
|---|---|---|
| **P-A** | Sensitivity analysis → limiter detection | Given a state, it names the correct limiter + modeled time-gain, reproducibly |
| **P-B** | F-A: limiter → key workout (LLM translation + structured output) | Weekly key session generated, tagged, explained; hard-rule validator still passes |
| **P-C** | F-B: the control loop | Three test weeks (perfect / missed-key / over-fatigued) yield three correct decisions |
| **P-D** | F-C: the three screens, Apple-grade | *Now* passes the five-second test; I want to open it daily |
| **P-E** | Garmin data-quality upgrade | Only if §2 step 1 shows real missing value |

**Gate (unchanged in spirit from `PROJECT.md`):** P-A/P-B are worthless if the underlying prediction isn't accurate. If F2 backtesting isn't under target, fix *that* before any of this. A beautiful adaptive loop on top of a wrong predictor is a confident liar.

---

## 6. What this PRD deliberately does NOT add

Holding the line from `PROJECT.md` §5, restated because "go big" is exactly when scope creep sneaks in:

- No multi-user, no accounts, no sharing.
- No general chat. "Why this workout?" is a *scoped* explanation of an existing decision, not an open assistant.
- No nutrition, sleep, HRV modeling. (Garmin may *surface* HR, but I'm not modeling recovery science.)
- No mobile app. Responsive web is the ceiling.
- No social / Strava-clone features.

"Go big" means **deep on F-A/F-B/F-C**, not wide on feature count.

---

## 7. Open decisions

- [ ] **CRUX — F-A has no dimensions to analyse yet.** The sensitivity loop iterates over
      `{aerobic_base, threshold, grade_durability}`, but none of the planned models express
      those as separable parameters: Riegel is time→time, VDOT is a *single scalar*, Banister
      gives load/fitness/fatigue. As designed, `f(state)` is scalar-in/scalar-out — you cannot
      run sensitivity analysis over dimensions the model doesn't represent. Either extend the
      model to express separable dimensions (e.g. a critical-speed model splitting aerobic vs
      anaerobic, plus an explicit grade term) or rescope F-A to what the math can express.
      **Blocks P-A. AI-free-zone work per §8 — mine to decide, not Claude's.**
- [ ] Name.
- [ ] `realistic weekly delta` per dimension — where do these numbers come from? (literature defaults, or fit from my own history?) Downstream of the CRUX above: pick the dimensions first.
- [ ] `training_cost` unit — TSS? session-RPE? Needs to be commensurable across dimensions or the ROI comparison is apples-to-oranges.
- [ ] How is uncertainty shown on *Now*? (band, range, confidence label?)
- [ ] Frontend stack for Apple-grade feel — and confirm it doesn't drag me into P-D before P-A/P-B are done.
- [ ] Does the control loop run on a schedule (Monday job) or on-demand when I open the app?
- [x] ~~Which podium — overall or age-group?~~ **RESOLVED 2026-07-18:** age-group, Varones
      18-29. Target = win the bracket, sub-1:37. See §0 "The target".
- [ ] Pull 2024/2025 **18-29 category** times to gauge how much the bracket bar actually moves
      year to year — 2026 had one 1:37 outlier and a 22-min gap to 2nd, so a single sample is
      a shaky basis for a goal. (Cronolap/RaceResult are JS portals; needs a browser, not a
      plain fetch.)

---

## 8. Process rules (still in force)

`PROJECT.md` §9 anti-atrophy rules carry over — **as amended 2026-07-19: the AI-free zone
is removed by owner decision** (see PROJECT.md §9 for the record and the compensating
controls: sourced formulas, reference-value tests, and the F2 backtest as the only judge).

- ~~The sensitivity-analysis core (P-A) is AI-free.~~ Superseded by the same amendment.