-- P0: the post-session check-in that closes the feedback loop (NEXT_STEPS.md).
--
-- Keyed by activity_id: feedback attaches to the real logged session (Strava's ID is
-- already stable), which is exactly what the weekly review audits. Without rows here
-- the review controller can never emit PROGRESS (readiness unconfirmed) nor DELOAD
-- (no red-flag source) — missing feedback is deliberately not a green signal.

create table session_feedback (
  activity_id       bigint primary key references activities(id) on delete cascade,
  -- session RPE 1-10; nullable because a strength check-in may only report focus
  rpe               integer check (rpe between 1 and 10),
  pain_during       text not null default 'not_reported'
                    check (pain_during in ('not_reported', 'none', 'mild', 'significant')),
  morning_soreness  text not null default 'not_reported'
                    check (morning_soreness in ('not_reported', 'none', 'normal', 'unusual')),
  -- strength sessions only: what the gym day actually was (Strava can't tell us)
  gym_focus         text check (gym_focus in ('upper', 'lower', 'full')),
  lower_body_difficulty text check (lower_body_difficulty in ('easy', 'moderate', 'hard')),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
