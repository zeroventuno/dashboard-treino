-- ────────────────────────────────────────────────────────────────────────────
--  add-agency-timezone.sql — what "today" is, for an agency.
--
--  WHY THIS IS NOT COSMETIC. Every date the coach panel reasons about starts
--  from the SERVER clock, and on Vercel the server clock is UTC. "Today" is not
--  a label there — it is the input to the readiness light, to the day's to-do
--  list, to "no check-in in N days", and to the check-in reconciliation. An
--  owner in Italy opening the panel at 00:30 local sees YESTERDAY's day, so an
--  athlete who checked in an hour ago reads as one more day silent, and a red
--  light lands on the wrong square. Off by one day, in exactly the numbers the
--  panel exists to state.
--
--  ONE ZONE PER AGENCY, not per athlete, and deliberately so. The panel's
--  question is "what do I do today", and the "I" is the professional reading
--  the screen — an agency in Rome with athletes in São Paulo still works a
--  Roman day. Per-athlete zones would be a different (larger) feature: the
--  athlete's own dashboard, not the agency's.
--
--  IANA NAMES, NOT OFFSETS. '+01:00' is wrong for half the year in Rome, and
--  storing an offset would make daylight saving a support ticket every March
--  and October. 'Europe/Rome' carries its own history.
--
--  THE NAME IS VALIDATED IN THE APP, NOT HERE, and that is not laziness: a
--  CHECK constraint must be IMMUTABLE, and the only list Postgres has
--  (pg_timezone_names) is a set-returning function that a CHECK may not call.
--  The runtime validates against Intl's own zone list and REFUSES an unknown
--  name rather than storing it — same house rule as everywhere else: a bad zone
--  would silently poison every date in the panel, and a wrong date reads as
--  fact. The check below is only about shape, so nothing obviously junk lands
--  even if someone writes the row by hand.
--
--  CURRENCY needs no DDL — `agencies.currency` has existed since
--  add-owner-and-value.sql and has simply never been editable outside SQL. The
--  owner selling in euros has been stuck on the BRL default. The panel gains
--  the edit alongside the zone (both are "what the agency is", one screen), so
--  this file only has to make sure app_writer may write the row.
--
--  Run once in the PRODUCT project's SQL Editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────────

-- 'UTC' rather than a guessed zone: UTC is what the panel already does today,
-- so an agency that never opens the setting keeps exactly the behaviour it has
-- instead of silently moving by a few hours on the day this migration runs.
alter table app.agencies add column if not exists timezone text not null default 'UTC';

-- Shape only (see the header): an IANA name is "Area/Location", or a bare word
-- for the handful like 'UTC'. This catches '' and '+01:00'; it cannot catch
-- 'Europe/Rime'. The app does that.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'agencies_timezone_shape') then
    alter table app.agencies add constraint agencies_timezone_shape check (
      timezone ~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$'
    );
  end if;
end $$;

-- The runtime edits both of these from the owner's panel. Still no business
-- with app.staff's api_key_hash or role, so those grants stay column-level
-- elsewhere; app.agencies is the agency's own row and is granted whole.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant select, update on app.agencies to app_writer';
  end if;
end $$;

-- Conferência.
select
  (select count(*) from information_schema.columns
    where table_schema='app' and table_name='agencies' and column_name='timezone')  as coluna_timezone, -- esperado 1
  (select count(*) from pg_constraint where conname = 'agencies_timezone_shape')    as check_de_forma,  -- esperado 1
  (select count(*) from app.agencies where timezone <> 'UTC')                       as fora_de_utc,
  (select count(*) from app.agencies where currency <> 'BRL')                       as fora_de_brl;
