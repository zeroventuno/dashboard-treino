-- ────────────────────────────────────────────────────────────────────────────
--  add-menstrual-cycle.sql — opt-in menstrual-cycle tracking (female athletes
--  who ask for it). Run ONCE in the product project's SQL Editor, as postgres.
--
--  Sensitive health data. It's isolated by RLS exactly like every other table,
--  and it only ever shows for an athlete whose profile declares the "menstrual"
--  metric (the coach sets that via set_profile, and only if the athlete opts in).
--
--  This is a NEW table, so enabling RLS here is CORRECT and safe — the policy is
--  created in the same script, so rows are never hidden without one. (The outage
--  footgun is clicking "Run and enable RLS" on an EXISTING table like
--  app.tenants, which enables RLS with no policy. Not this. Just run the whole
--  script; if the editor pops an RLS toggle, ignore it — the SQL handles it.)
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists menstrual_cycle (
  tenant_id         uuid primary key references app.tenants(id) on delete cascade,
  last_period_start date not null,
  cycle_length      int  not null default 28,
  period_length     int  not null default 5,
  notes             text,
  updated_at        timestamptz not null default now()
);

-- Row-level security: same tenant-isolation shape as the rest of schema.sql.
alter table menstrual_cycle enable row level security;
drop policy if exists tenant_isolation on menstrual_cycle;
create policy tenant_isolation on menstrual_cycle
  using (tenant_id = current_setting('app.tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- The runtime role usually inherits this from ALTER DEFAULT PRIVILEGES, but be
-- explicit so the tool works even if that wasn't set. Guarded so it's a no-op
-- on a DB that has no app_writer role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant select, insert, update, delete on menstrual_cycle to app_writer';
  end if;
end $$;

-- Confirmation.
select
  (select count(*) from information_schema.tables
     where table_schema = 'public' and table_name = 'menstrual_cycle') as table_created,
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'menstrual_cycle') as policies;
