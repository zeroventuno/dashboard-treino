-- ════════════════════════════════════════════════════════════════════════════
--  MY TRAKR (multi-tenant product) — full Phase 0 schema.
--
--  Apply to a NEW Supabase project (any account). The personal dashboard's
--  project stays untouched. Isolation: every data table carries tenant_id and
--  RLS scopes ALL access to current_setting('app.tenant_id'). The dashboard
--  read path and the coach MCP write path both set that session var to the
--  authenticated tenant before querying — a forgotten WHERE can never leak
--  across tenants. Customers never get a Supabase key, only an account API key
--  that our MCP server exchanges for a tenant_id.
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- Private schema for account/secret data. Supabase's auto Data API (PostgREST)
-- only exposes `public` (+ graphql_public), so anything here is invisible to
-- the anon key — keeps api_key_hash and emails off the public API entirely.
create schema if not exists app;

-- ── Accounts (private schema — never exposed via the Data API) ──────────────
create table app.tenants (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  status        text not null default 'trialing',   -- trialing | active | canceled
  plan          text not null default 'free',
  api_key_hash  text not null,                       -- sha256 of the per-account MCP key
  created_at    timestamptz not null default now()
);

-- ── Per-athlete config (drives the adaptive dashboard) ──────────────────────
create table profiles (
  tenant_id   uuid primary key references app.tenants(id) on delete cascade,
  athlete     text,
  devices     text[] not null default '{}',
  metrics     text[] not null default '{}',          -- capability flags
  mode        text   not null default 'race',         -- race | cycle
  locale      text   not null default 'pt',
  units       text   not null default 'metric',
  updated_at  timestamptz not null default now()
);

create table races (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references app.tenants(id) on delete cascade,
  name       text not null,
  date       date not null,
  priority   text not null default 'A'                -- A | B | C
);
create index on races(tenant_id, date);

create table training_cycles (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references app.tenants(id) on delete cascade,
  name        text not null,
  start_date  date not null,
  weeks       int  not null,
  phases      jsonb not null default '[]',            -- [{name, weeks, focus}]
  active      boolean not null default true
);
create index on training_cycles(tenant_id);

-- ── Training data (mirrors the current dashboard schema + tenant_id) ────────
create table workouts (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references app.tenants(id) on delete cascade,
  date                  date not null,
  discipline            text not null,
  title                 text not null,
  description           text,
  garmin_instructions   text,
  zwo_content           text,
  status                text not null default 'planned',
  planned_duration_min  numeric,
  actual_duration_min   numeric,
  planned_distance_km   numeric,
  actual_distance_km    numeric,
  planned_tss           numeric,
  actual_tss            numeric,
  planned_pace          text,
  actual_pace           text,
  planned_power_watts   text,
  actual_power_watts    text,
  notes                 text,
  nutrition_notes       text,
  -- Session detail added after the first deploy (see workout-sections.sql, which
  -- migrates existing projects). Kept here too so this file alone still builds a
  -- complete, current schema — a fresh project created from it was missing these
  -- and the dashboard queries referenced columns that didn't exist.
  structure             jsonb,          -- [{kind,label,minutes,intensity}] → profile chart
  activation            text,           -- drills / warm-up before the session
  nutrition_pre         text,
  mobility              text,           -- stretching / cool-down after
  nutrition_post        text,
  key_workout           boolean not null default false,
  created_at            timestamptz not null default now(),
  unique (tenant_id, date, discipline, title)
);
create index on workouts(tenant_id, date);

create table training_load (
  tenant_id  uuid not null references app.tenants(id) on delete cascade,
  date       date not null,
  tss        numeric,
  ctl        numeric,
  atl        numeric,
  tsb        numeric,
  source     text,
  primary key (tenant_id, date)
);

create table checkins (
  tenant_id               uuid not null references app.tenants(id) on delete cascade,
  date                    date not null,
  hrv                     numeric,
  sleep_hours             numeric,
  readiness_score         numeric,
  body_battery            numeric,
  resting_hr              numeric,
  recommendation          text,
  notes                   text,
  hydration_liters        numeric,
  whey_shakes             numeric,
  protein_grams_estimate  numeric,
  primary key (tenant_id, date)
);

create table phases (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references app.tenants(id) on delete cascade,
  name        text not null,
  start_date  date not null,
  end_date    date not null,
  focus       text,
  color       text
);
create index on phases(tenant_id, start_date);

create table performance_milestones (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references app.tenants(id) on delete cascade,
  date       date not null,
  metric     text not null,
  value      numeric,
  unit       text,
  notes      text,
  unique (tenant_id, date, metric)
);

create table performance_indicators (
  tenant_id           uuid primary key references app.tenants(id) on delete cascade,
  updated_at          timestamptz not null default now(),
  ftp_watts           numeric,
  bike_zones          jsonb,
  run_pace_zones      jsonb,
  swim_pace_per_100m  text,
  swim_pace_zones     jsonb,
  run_threshold_pace  text,
  cadence_run_target  numeric,
  hr_zones            jsonb
);

create table strength_sessions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references app.tenants(id) on delete cascade,
  date           date not null,
  muscle_groups  text[] not null default '{}',
  exercises      jsonb,
  notes          text
);
create index on strength_sessions(tenant_id, date);

create table injury_log (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references app.tenants(id) on delete cascade,
  date       date not null,
  area       text not null,
  severity   int,
  notes      text
);
create index on injury_log(tenant_id, date);

create table body_composition (
  tenant_id       uuid not null references app.tenants(id) on delete cascade,
  date            date not null,
  weight_kg       numeric,
  muscle_mass_kg  numeric,
  body_fat_pct    numeric,
  lean_mass_kg    numeric,
  visceral_fat    numeric,
  metabolic_age   numeric,
  notes           text,
  primary key (tenant_id, date)
);

create table daily_meal_plan (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references app.tenants(id) on delete cascade,
  meal_order       int not null,
  meal_name        text not null,
  time_suggestion  text,
  foods            text,
  protein_g        numeric,
  carbs_g          numeric,
  notes            text
);
create index on daily_meal_plan(tenant_id, meal_order);

create table nutrition_plan (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references app.tenants(id) on delete cascade,
  duration_category   text not null,
  duration_range      text,
  discipline_context  text,
  before_training     text,
  during_training     text,
  after_training      text,
  supplements_used    text[],
  notes               text
);
create index on nutrition_plan(tenant_id);

-- ── Row-level security: isolate every tenant (one policy per table) ─────────
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','races','training_cycles','workouts','training_load','checkins',
    'phases','performance_milestones','performance_indicators','strength_sessions',
    'injury_log','body_composition','daily_meal_plan','nutrition_plan'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy tenant_isolation on %I using (tenant_id = current_setting(''app.tenant_id'', true)::uuid) with check (tenant_id = current_setting(''app.tenant_id'', true)::uuid)',
      t
    );
  end loop;
end $$;

-- Note: with RLS on + this policy, the anon Data API also sees ZERO rows in
-- every public table (current_setting is unset there → predicate is NULL → no
-- match). Isolation holds against both a forgotten WHERE and the public API.
--
-- The API layer runs, per request/transaction, BEFORE any query:
--     select set_config('app.tenant_id', '<authenticated tenant uuid>', true);
-- app.tenants is looked up by api_key_hash during auth — it lives in the private
-- `app` schema, so it's off the Data API and never reachable by the anon key.
--
-- For RLS to be a real safety net on the write path, the MCP server should
-- connect as a NON-superuser role (RLS is bypassed by superuser/service_role).
-- Create one and grant access:
--     create role app_writer login password '...';
--     grant usage on schema app, public to app_writer;
--     grant select on app.tenants to app_writer;                    -- auth lookup only
--     grant select, insert, update, delete on all tables in schema public to app_writer;
--     -- (app_writer is NOT superuser → RLS applies to the public tables)
