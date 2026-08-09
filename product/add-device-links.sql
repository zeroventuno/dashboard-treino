-- ────────────────────────────────────────────────────────────────────────────
--  add-device-links.sql — connecting an athlete's watch.
--
--  The dashboard already has the normalised model a device feed needs: checkins
--  carries hrv / sleep_hours / readiness_score / body_battery / resting_hr, and
--  workouts carries the actual_* columns. Nothing about that has to change. What
--  was missing was somewhere to keep the athlete's authorisation so a background
--  job can write into it.
--
--  Strava first, deliberately: it is self-serve (no partnership approval), and
--  most athletes already sync Garmin, Coros, Polar or Suunto into it — so one
--  integration inherits four brands. `provider` is open text so Polar, Whoop or
--  Oura slot in later without a migration.
--
--  Tokens live in the PRIVATE `app` schema, never in `public`: they are
--  credentials, and public tables are the ones reachable through PostgREST.
--
--  Run once in the product project's SQL Editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists app.device_links (
  tenant_id      uuid not null references app.tenants(id) on delete cascade,
  provider       text not null,                    -- strava | polar | whoop | oura | …
  external_id    text,                             -- the athlete's id at the provider
  access_token   text not null,
  refresh_token  text,
  expires_at     timestamptz,
  scope          text,
  last_sync_at   timestamptz,
  last_error     text,                             -- surfaced in the UI, never swallowed
  created_at     timestamptz not null default now(),
  primary key (tenant_id, provider)
);

-- Idempotent import: a re-sync must update the session it already wrote instead
-- of stacking duplicates. Nullable because everything written by a coach or by
-- hand has no external origin.
alter table workouts add column if not exists external_id text;
create unique index if not exists workouts_external_uniq
  on workouts (tenant_id, external_id) where external_id is not null;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant select, insert, update, delete on app.device_links to app_writer';
  end if;
end $$;

select
  (select count(*) from app.device_links)                                  as links,
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='workouts'
      and column_name='external_id')                                       as workouts_external_id;
