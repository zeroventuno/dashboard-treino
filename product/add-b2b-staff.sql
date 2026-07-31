-- ────────────────────────────────────────────────────────────────────────────
--  add-b2b-staff.sql — B2B backbone (Fase 1): a coaching agency with staff
--  members (professionals) who each act across a roster of athletes.
--
--  "One athlete, one dashboard, written by several hands": a coach writes
--  training, a nutritionist writes nutrition, a physio writes injury/rehab —
--  each a licensed professional, each scoped to their own tools (the scoping
--  itself lands in the MCP server, next step). This migration is just the data.
--
--  Everything lives in the PRIVATE `app` schema, exactly like app.tenants, so
--  it's invisible to the anon Data API. Do NOT enable RLS here — the app schema
--  isn't exposed via PostgREST, and the app_writer role reads these for auth
--  (same posture as app.tenants; enabling RLS there once broke every login).
--
--  Run once in the product project's SQL Editor, as postgres.
-- ────────────────────────────────────────────────────────────────────────────

-- The B2B customer: a coaching business / assessoria.
create table if not exists app.agencies (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  status     text not null default 'active',   -- active | canceled
  plan       text not null default 'solo',      -- solo | studio | pro
  created_at timestamptz not null default now()
);

-- A professional under an agency. Authenticated by their own key (trakc_...),
-- hashed like tenant keys. `role` is an OPEN string (coach | nutritionist |
-- physio | ...) so adding a new profession is data, not a migration.
create table if not exists app.staff (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references app.agencies(id) on delete cascade,
  name         text,
  email        text,
  role         text not null,                    -- coach | nutritionist | physio | ...
  api_key_hash text not null unique,             -- sha256 of trakc_<random>
  status       text not null default 'active',   -- active | canceled
  created_at   timestamptz not null default now()
);
create index if not exists staff_agency_idx on app.staff (agency_id);

-- Roster: which athletes a staff member may act on. Many staff (coach + nutri +
-- physio) can share one athlete; per-staff so coach A can't touch coach B's.
create table if not exists app.staff_athletes (
  staff_id   uuid not null references app.staff(id) on delete cascade,
  tenant_id  uuid not null references app.tenants(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (staff_id, tenant_id)
);
create index if not exists staff_athletes_tenant_idx on app.staff_athletes (tenant_id);

-- Group an athlete under its agency (agency-level ops later; nullable = B2C).
alter table app.tenants add column if not exists agency_id uuid references app.agencies(id);

-- Display name in the PRIVATE schema, so a staff member can list their roster
-- without a per-athlete RLS context (profiles.athlete is under RLS and returns
-- zero rows with no app.tenant_id set). Set at provisioning time.
alter table app.tenants add column if not exists athlete_name text;

-- The runtime role reads these three for auth/roster, same as it reads
-- app.tenants. New app.* tables do NOT inherit grants, so grant explicitly.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant usage on schema app to app_writer';
    execute 'grant select on app.agencies, app.staff, app.staff_athletes to app_writer';
  end if;
end $$;

-- Confirmation.
select
  (select count(*) from information_schema.tables where table_schema='app' and table_name='agencies')       as agencies,
  (select count(*) from information_schema.tables where table_schema='app' and table_name='staff')           as staff,
  (select count(*) from information_schema.tables where table_schema='app' and table_name='staff_athletes')  as staff_athletes;

-- ── Provisioning template (fill in and run to create a test agency) ─────────
-- Uses pgcrypto's digest() to hash the key exactly like the Node server does
-- (sha256 hex). Generate a key like: trakc_ + 32 random hex/base chars.
--
-- with a as (
--   insert into app.agencies (name, plan) values ('Assessoria Teste', 'studio')
--   returning id
-- ), s as (
--   insert into app.staff (agency_id, name, role, api_key_hash)
--   select a.id, 'João (coach)', 'coach',
--          encode(digest('trakc_COLE_A_CHAVE_AQUI', 'sha256'), 'hex')
--   from a
--   returning id
-- )
-- insert into app.staff_athletes (staff_id, tenant_id)
-- select s.id, t.id from s, app.tenants t
-- where t.email in ('atleta1@exemplo.com', 'atleta2@exemplo.com');
--
-- (Also set app.tenants.athlete_name / agency_id for those tenants so the
--  roster shows names and groups under the agency.)
