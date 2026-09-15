# DECISIONS.md

Weekly log: what I learned, what I decided, why. 30 min, in English. (PROJECT.md §9)

## 2026-07-12 — Project start

- Defined PROJECT.md v2. Key calls: Supabase over local Docker (survives my Mac being off),
  confidence intervals via empirical backtest-error quantiles, race inventory (T0) promoted
  to first task because it decides whether S1 is measurable at all.
- <!-- your own notes go here -->

## 2026-09-07 — Reading the plan back against my own runs

- Audited the live coach output against the actual activity log for the first time, and
  found three controller defects the unit tests could not see, because each one is only
  visible when real (interrupted, irregular) training meets the template:
  **C1** the long run came out shorter than the easy runs on a 3-day week;
  **C2** the volume baseline anchored only on last week, so the plan followed me
  downwards instead of leading me back up; **C3** an all-easy key session was scored by
  calendar date rather than by dose, so real long runs read as missed.
  All three fixed with regression tests; details in `NEXT_STEPS.md`.
- **The lesson worth keeping:** every one of these passed 148 generated template cases
  and the S2 validator. They are not rule violations — the week was *valid* every time.
  They are prescriptions that are internally consistent and coaching nonsense. A
  validator proves a week breaks no rules; it cannot prove the week is worth running.
  The missing layer is an assertion about the plan's *shape* (the key session is the
  biggest run; the plan never prescribes less than I already do unprompted) — that
  belongs in the F4 eval harness, not in more validator rules.
- Decided **not** to re-score the stored `week_review` row for 2026-08-31 under the fixed
  C3 rule. Rewriting a stored review to make history look better is exactly what red-team
  M2 (immutable plan revisions) exists to prevent. It costs nothing here: REPEAT and
  PROCEED both progress at 1.0.
- Confirmed P0 is correctly first in the order, for a sharper reason than "feedback is
  nice": `readinessConfirmed` is never passed in production, so PROGRESS is unreachable
  and the progression factor is capped at 1.0 forever. Until the check-in ships, the
  controller literally cannot prescribe growth — it can only hold or cut.

## 2026-09-07 (later) — Closing the loop, and making the app look forward

- **Shipped P0**, the post-session check-in, and deleted `docs/p0-checkin-implementation.md`
  with it. The rule I want to hold: `docs/` is for work that has NOT happened. A spec for
  shipped code is a second source of truth that rots. Code plus tests are the spec;
  NEXT_STEPS carries the state; DECISIONS carries the why.
- **Built the forward model** (`deterministic/trajectory.ts`). The whole controller was
  reactive — last week's volume, the recent peak, was the last plan completed. Nothing
  answered the question I actually ask the app, which is whether I am on track for April.
  Working backwards from race day gives a required compounding rate, and the number worth
  looking at is **slack weeks**: 3, at +8.8%/week. Not "train harder" — "don't skip".
- **The design call I am most sure about:** the trajectory can shape growth that readiness
  has already earned, but it can never create growth on its own. A calendar that is allowed
  to push a body it cannot see is how training apps hurt people. Being behind is a reason to
  be told, not pushed. Readiness outranks the calendar, and the forward model does not get
  an exemption from that just because it is smarter than what came before.
- Consequence I should expect and not be annoyed by: until I actually fill in check-ins,
  the plan will hold flat no matter what the trajectory says. That is the system working.

## 2026-09-14 — The validator was never going to catch these

- Four changes shipped: run days inferred from my own history, one-tap check-ins,
  a coaching-property layer, and the +10% session guardrail applied to every run
  instead of just one. 867 tests.
- **The thread connecting all of them:** every defect this week was found by reading
  the live plan against my actual training log, and every one passed the S2 validator.
  The plan had prescribed Tue/Thu/Sun for *five consecutive weeks* to someone who ran
  Mon/Wed/Sun every single time. The week was legal every time. Nothing noticed,
  because nothing was looking at the athlete — only at the rulebook.
- So I built the thing that looks at the athlete. `coachProperties.ts` asks whether a
  legal week still makes sense: is the key session actually the longest run, is the plan
  below what I already do unprompted, do the prescribed days match the days I train.
  Advisory rather than hard rules, because unlike a rule violation a property can fail
  for a defensible reason.
- **It paid for itself within the hour.** The property matrix immediately found that the
  injury guardrail — the one with real cohort evidence behind it — was applied to one
  session per week and absent from the other two thirds. A returning athlete whose
  longest run was 2km would have been handed 4km easy days.
- It also caught two things I had *written wrong*: quality weeks key the hardest session,
  not the longest, so "key is longest" only holds for all-easy weeks; and return_to_run
  belongs with taper and deload as a phase allowed to prescribe below recent behavior,
  because its caps hold me under what my cardiovascular system could manage on purpose.
  The limiter there is tissue, not fitness.
- **Design line I keep restating because it keeps mattering:** adapt where sessions land,
  never what they are. Run-day inference changes the anchor `scheduleScore` measures
  from; it cannot break spacing, lower-body conflicts or the rest day. Same shape as the
  trajectory shaping growth but never creating it. The app fits my life; it does not let
  my life erode the training.
- On the goal: I finally separated "run 1:37:14" from "win the bracket". They are not the
  same question. 2nd place in 2026 ran 1:59:08 — twenty-two minutes back. I set my target
  to the hardest number in the table and assumed that was the price of winning. Sub-1:48
  is the honest A-goal, and chasing 1:37 is actually the *riskier* path to winning,
  because it pushes past what my consistency record supports. Longest streak of 3+ run
  weeks in 78 weeks: eight. The build needs twenty-nine.

