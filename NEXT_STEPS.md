# Coach v2 — first review and roadmap

Updated 2026-07-19 for the Patagonia Running Festival 21K on 2027-04-24.

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

The target remains sub-1:37:14 for the 21K trail course. Under the app's current course
assumptions, that requires substantially better fitness than the 1:38:19 road PB; the
2026 age-group winning time is a benchmark, not a guarantee of winning in 2027.

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

## Inputs still needed from Juan

The most valuable next input is the gym split. Set `ATHLETE_GYM_DAYS` and
`ATHLETE_LOWER_BODY_DAYS` in `.env` using 0=Monday through 6=Sunday. Strava's
`Weight Training` label cannot distinguish upper, lower, or full-body work.

The next product input is a 20-second post-session check-in:

- Session RPE (1–10).
- Pain during the run.
- Pain or unusual soreness the next morning.
- Gym focus and lower-body difficulty.

Without those signals the software can measure completion and external load, but it
cannot know whether impact was tolerated. Missing feedback must never be treated as a
green recovery signal.

## Highest-priority product gaps

### P0 — close the real feedback loop

- Add activity/session feedback and surface medical stop flags.
- Match planned and actual sessions with stable IDs, discipline, duration, purpose, and
  required/optional role.
- Review time-at-effort and duration, not only kilometers.
- Store immutable plan revisions so a replan cannot erase the prescription being audited.

### P1 — make the nine-month forecast real

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
