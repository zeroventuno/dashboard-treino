-- ────────────────────────────────────────────────────────────────────────────
--  add-zone-time.sql — how much of the session happened in each zone.
--
--  Duration, distance and TSS say whether the session HAPPENED. They cannot say
--  whether it was the RIGHT session: 4x8min at threshold and an hour of easy
--  spinning are the same sixty minutes, and until now they scored the same.
--
--  One jsonb of six integers, not a table of samples. The per-second recording
--  is tens of thousands of numbers per session and no coach reads it — the
--  totals are what answers "did the volume, missed the intensity". Keeping the
--  raw trace would also mean warehousing provider data we'd be obliged to delete
--  if the API relationship ended.
--
--    {"z0": 0, "z1": 120, "z2": 2400, "z3": 0, "z4": 1080, "z5": 0}
--
--  z0 is prescribed time the coach left open ("easy spin", no target). It exists
--  so an open block isn't scored as if zone 1 had been asked for.
--
--  Nullable, and stays null for every athlete without a device — computeAdherence
--  falls back to the old duration/TSS/distance estimate, so nothing regresses.
--
--  Run once in the product project's SQL Editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────────

alter table workouts add column if not exists actual_zones jsonb;

-- Six non-negative integers under the expected keys, or nothing. Cheap to check
-- on write, and it stops a malformed import from quietly poisoning every
-- adherence score and weekly 80/20 read that trusts this column.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'workouts_actual_zones_shape'
  ) then
    alter table workouts add constraint workouts_actual_zones_shape check (
      actual_zones is null or (
        jsonb_typeof(actual_zones) = 'object'
        and actual_zones ?& array['z0','z1','z2','z3','z4','z5']
        and not exists (
          select 1 from jsonb_each(actual_zones) as e(k, v)
          where jsonb_typeof(v) <> 'number' or (v)::numeric < 0
        )
      )
    );
  end if;
end $$;

select
  (select count(*) from information_schema.columns
    where table_schema='public' and table_name='workouts'
      and column_name='actual_zones')                          as has_column,
  (select count(*) from workouts where actual_zones is not null) as sessions_with_zones;
