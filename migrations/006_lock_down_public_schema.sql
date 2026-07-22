-- This is a server-only application. Nothing in the browser uses Supabase's Data API,
-- so anon/authenticated/service_role should have no direct access to application data.
-- The Vercel server connects as the database owner and therefore continues to work.

alter table public.schema_migrations enable row level security;
alter table public.activities enable row level security;
alter table public.activity_streams enable row level security;
alter table public.races enable row level security;
alter table public.fitness_state enable row level security;
alter table public.plan_week enable row level security;
alter table public.week_review enable row level security;
alter table public.prediction_log enable row level security;
alter table public.session_feedback enable row level security;

-- RLS is the row-level boundary; revoking grants is an additional object-level
-- boundary. No policies are intentionally created, so Data API access is deny-all.
revoke all privileges on all tables in schema public from anon, authenticated, service_role;
revoke all privileges on all sequences in schema public from anon, authenticated, service_role;

-- Tables created by future migrations must remain private unless access is explicitly
-- granted as part of that migration.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
