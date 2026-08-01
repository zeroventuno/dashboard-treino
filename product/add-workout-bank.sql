-- ────────────────────────────────────────────────────────────────────────────
--  add-workout-bank.sql — the agency's library of reusable, coach-validated
--  workouts. Fills once (AI copilot, n8n generation, or import), reused forever
--  when prescribing: the batch flow pulls validated items by sport+phase and
--  writes them onto athletes.
--
--  Agency-level (shared across the agency's professionals), in the private `app`
--  schema like the rest of the B2B tables → no RLS, app_writer accesses it with
--  an explicit agency_id filter. Run once in the product project's SQL Editor.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists app.workout_bank (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references app.agencies(id) on delete cascade,
  created_by   uuid references app.staff(id) on delete set null,
  sport        text not null,                       -- swim | bike | run | strength
  phase        text,                                -- Base | Build | Peak | Taper (nullable)
  title        text not null,
  structure    jsonb,                               -- [{label,duration_min,intensity,target,note}]
  duration_min int,
  tss          int,
  description  text,
  source       text not null default 'ai',          -- ai | import | manual
  status       text not null default 'draft',       -- draft | validated | archived
  tags         text[] not null default '{}',
  created_at   timestamptz not null default now()
);
create index if not exists workout_bank_lookup
  on app.workout_bank (agency_id, sport, phase, status);

grant select, insert, update, delete on app.workout_bank to app_writer;

select count(*) as workout_bank_rows from app.workout_bank;
