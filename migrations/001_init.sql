-- Core tables for F0a (bulk-export backfill).
-- Streams live in their own table from day one: GAP/Minetti (F1) needs per-point
-- distance + altitude, and retrofitting streams later would force a full re-ingest.

create table activities (
  id                bigint primary key,          -- Strava activity id
  name              text not null,
  sport_type        text not null,               -- as reported by Strava: Run, Ride, Weight Training, ...
  start_date        timestamptz not null,
  elapsed_time_s    integer,
  moving_time_s     integer,
  distance_m        double precision,
  elevation_gain_m  double precision,
  avg_hr            double precision,
  max_hr            double precision,
  source            text not null check (source in ('bulk_export', 'api')),
  source_file       text,                        -- e.g. activities/123456.fit.gz within the export
  raw               jsonb,                       -- full original record, so re-normalizing never needs re-ingesting
  created_at        timestamptz not null default now()
);

create index activities_start_date_idx on activities (start_date);
create index activities_sport_type_idx on activities (sport_type);

create table activity_streams (
  activity_id  bigint primary key references activities(id) on delete cascade,
  -- parallel arrays, one entry per track point; null entries = sensor missing at that point
  time_s       integer[] not null,               -- seconds relative to activity start
  distance_m   double precision[],               -- cumulative; from device when available, else haversine over GPS
  altitude_m   double precision[],
  heartrate    integer[]
);

-- The backtest set (T0). Populated by hand: official results are the ground truth
-- and no API provides them reliably.
create table races (
  id               serial primary key,
  activity_id      bigint references activities(id),
  name             text not null,
  race_date        date not null,
  distance_m       double precision not null,
  official_time_s  integer not null,
  terrain          text not null check (terrain in ('road', 'trail', 'track')),
  elevation_gain_m double precision,
  results_url      text,
  notes            text
);
