-- ────────────────────────────────────────────────────────────────────────────
--  add-plan-blocks.sql — the agency's multi-week templates.
--
--  The workout bank holds single sessions, and prescribing one session at a time
--  does not scale to a hundred athletes however good the batch modal is: the
--  UNIT is wrong. A coach's real decision is not "Tuesday, threshold intervals"
--  — it is "this cohort starts a four-week Base block on Monday". One decision a
--  month per cohort instead of thirty a week.
--
--  Stored beside app.workout_bank rather than inside it. A block is not a longer
--  workout: it has weeks, its sessions carry no date, and applying it produces
--  many rows in `workouts` rather than one. Folding it into the bank would have
--  meant a nullable "weeks" column on every single session and a discriminator
--  read on every query.
--
--  The week's sessions have NO weekday. Which day a session lands on is decided
--  per athlete at apply time, from the availability they filled in themselves —
--  Tuesday is 45 minutes for one and three hours for another, and the swim squad
--  meets Thursday for one of them and never for the rest. See lib/plan-block.
--
--  Run once in the product project's SQL Editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists app.plan_blocks (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references app.agencies(id) on delete cascade,
  created_by  uuid references app.staff(id) on delete set null,
  name        text not null,
  -- Base | Build | Peak | Taper — the cohort this block is written for, matching
  -- the phase names the season timeline and the workout bank already use.
  phase       text,
  notes       text,
  -- [{ focus, sessions: [{ discipline, title, duration_min, structure, long, key_workout }] }]
  -- One entry per week, in order. The array length IS the block length, so a
  -- separate `weeks` integer could only ever disagree with it.
  weeks       jsonb not null default '[]'::jsonb,
  status      text not null default 'draft',   -- draft | active | archived
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists plan_blocks_agency on app.plan_blocks (agency_id, status);

-- A block with no weeks would silently apply nothing, which reads to the coach
-- as the feature being broken rather than the template being empty.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plan_blocks_weeks_shape') then
    alter table app.plan_blocks add constraint plan_blocks_weeks_shape
      check (jsonb_typeof(weeks) = 'array');
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant select, insert, update, delete on app.plan_blocks to app_writer';
  end if;
end $$;

select
  (select count(*) from information_schema.tables
    where table_schema='app' and table_name='plan_blocks') as has_table,
  (select count(*) from app.plan_blocks)                   as blocks;
