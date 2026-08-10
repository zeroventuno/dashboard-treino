-- ────────────────────────────────────────────────────────────────────────────
--  add-session-rpe.sql — how hard it actually felt.
--
--  The athlete with the least equipment is the one the dashboard currently
--  serves worst. Their sessions are prescribed in RPE, because that is the only
--  scale that needs no device — and then nothing records the RPE they came back
--  with, so their score falls all the way back to duration and distance. The
--  person with no numbers ends up with the vaguest reading of all.
--
--  On the WORKOUT, not the daily check-in: RPE belongs to a session. An athlete
--  who swims in the morning and rides in the evening has two, and a single
--  daily field would force them to average two different efforts into one
--  meaningless number.
--
--  Borg CR10 — the 0-10 scale athletes already answer in when asked how hard
--  something was. Not the 6-20 Borg scale, which needs explaining.
--
--  Run once in the product project's SQL Editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────────

alter table workouts add column if not exists actual_rpe numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workouts_actual_rpe_range') then
    alter table workouts add constraint workouts_actual_rpe_range
      check (actual_rpe is null or (actual_rpe >= 0 and actual_rpe <= 10));
  end if;
end $$;

select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='workouts' and column_name='actual_rpe') as has_column,
  (select count(*) from workouts where actual_rpe is not null)                          as sessions_with_rpe;
