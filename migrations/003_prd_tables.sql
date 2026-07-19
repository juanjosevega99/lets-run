-- PRD §4 data model additions. Schema mirrors the PRD's own wording; the dimension
-- columns on fitness_state (threshold/aerobic/grade_durability estimates) are nullable
-- on purpose — PRD §7's CRUX (which dimensions the model can actually express) is
-- unresolved and hand-written work. Columns may be revised when that lands.

-- Per-day fitness snapshot. Written by the (hand-written, F1) fitness models via a
-- rebuild pipeline; read by F-A sensitivity analysis and the Trajectory screen.
create table fitness_state (
  day                       date primary key,
  ctl                       double precision,
  atl                       double precision,
  tsb                       double precision,
  threshold_estimate        double precision,
  aerobic_estimate          double precision,
  grade_durability_estimate double precision,
  model_version             text,
  computed_at               timestamptz not null default now()
);

-- The prescribed week (F-A output via F3). key_session carries the limiter tag and
-- modeled time-gain so F-B knows which session was load-bearing.
create table plan_week (
  id                   serial primary key,
  week_start           date not null unique,      -- Monday
  target_limiter       text,
  modeled_time_gain_s  double precision,
  key_session          jsonb not null,
  support_sessions     jsonb not null,            -- array
  explanation          text,
  model_version        text,
  generated_at         timestamptz not null default now()
);

-- Planned vs actual: the audit trail that makes F-B trustworthy.
create table week_review (
  id               serial primary key,
  week_start       date not null unique,
  compliance_pct   double precision,
  planned_load     double precision,
  actual_load      double precision,
  decision         text check (decision in ('PROGRESS', 'REPEAT', 'PROCEED', 'DELOAD')),
  decision_inputs  jsonb,                         -- the numbers that drove the decision
  explanation      text,
  reviewed_at      timestamptz not null default now()
);

-- Every prediction ever made, with its data cutoff, so backtesting stays honest
-- (PROJECT.md F2/S1). Backtest rows carry race_id; live predictions leave it null.
create table prediction_log (
  id                serial primary key,
  predicted_at      timestamptz not null default now(),
  data_cutoff       date not null,
  race_id           integer references races(id),
  race_distance_m   double precision not null,
  predicted_time_s  double precision not null,
  interval_p10_s    double precision,
  interval_p90_s    double precision,
  predictor         text not null,               -- model name/version that produced it
  context           jsonb
);

create index prediction_log_predicted_at_idx on prediction_log (predicted_at);
