-- ────────────────────────────────────────────────────────────────────────────
--  add-roster-load.sql — fatigue, on the consolidated roster.
--
--  The coach panel shows readiness, injuries, last check-in and plan coverage,
--  and carries no training-load data at all. So "which of my athletes is showing
--  overtraining signals" can only be answered by opening sixty athletes one at a
--  time — which means it is never answered, and the athlete who has been digging
--  a hole for three weeks is found after the bad session, not before it.
--
--  WHY THIS DOES NOT READ `training_load`
--
--  The obvious implementation reads the training_load table, which has exactly
--  the columns wanted (ctl, atl, tsb, per day). It would also return nothing:
--  that table is populated ONLY by the one-off import, and no tool in the
--  product writes it. lib/data-product.ts says so outright, and builds the
--  athlete's own chart by deriving the curve from their sessions at read time.
--  A roster column reading training_load would be correct code sitting on an
--  empty table.
--
--  So this returns the raw material the PMC is actually built from — the
--  sessions — and lib/pmc-curve.ts turns them into the curve, using the SAME
--  function that draws the athlete's own chart. Deriving CTL/ATL in SQL as well
--  would have been a third copy of an accumulating recurrence, and because CTL
--  integrates everything before it, a small difference in the rule compounds
--  rather than cancels: the coach's screen and the athlete's screen would state
--  different facts about the same person on the same day.
--
--  WHAT COUNTS AS A SESSION'S TSS
--
--  Deliberately NOT decided here. This returns actual_tss and planned_tss side
--  by side, plus the fields the dashboard computes TSS from when neither is set
--  (duration, power, pace, time-in-zone) and the athlete's thresholds. The
--  choice between them is lib/stress.ts computeStress, unchanged and uncopied.
--  Doing the coalesce in SQL instead would have quietly used the PRESCRIBED load
--  for every session the coach never scored by hand — which is most of them —
--  and an athlete who consistently under-executes would read as more fatigued on
--  the coach's roster than on their own chart.
--
--  NO STATUS FILTER, and that is a mirror, not an oversight: lib/data-product.ts
--  counts every session row regardless of status. It is very probably wrong —
--  `moved` leaves the struck-through original AND a planned copy, so a
--  rescheduled session is counted twice — but the fix belongs in the shared
--  function where BOTH screens get it at once, not in a divergence introduced
--  here. See the note in lib/pmc-curve.ts dailyTss.
--
--  Same SECURITY DEFINER pattern as app.roster_planned_ahead: the function owns
--  the cross-tenant read, and the staff_athletes join is the entire
--  authorisation boundary — a professional sees only their own roster.
--
--  Run once in the product project's SQL Editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────────

drop function if exists app.roster_load(uuid);
drop function if exists app.roster_load(uuid, int);

create function app.roster_load(p_staff_id uuid, p_days int default 180)
returns table (
  tenant_id           uuid,
  date                date,
  status              text,
  discipline          text,
  actual_tss          numeric,
  planned_tss         numeric,
  actual_duration_min numeric,
  actual_power_watts  text,
  actual_pace         text,
  actual_zones        jsonb,
  -- The athlete's thresholds, repeated on every row of theirs. Denormalised on
  -- purpose: computing TSS from power or pace needs them, and one wide result
  -- set is one round trip for the whole roster instead of one query per athlete
  -- — which is the cost that made this feature not exist in the first place.
  ftp_watts           numeric,
  run_threshold_pace  text,
  swim_pace_per_100m  text
)
language sql
security definer
set search_path = app, public
as $$
  select
    sa.tenant_id,
    w.date,
    w.status,
    w.discipline,
    w.actual_tss,
    w.planned_tss,
    w.actual_duration_min,
    w.actual_power_watts,
    w.actual_pace,
    w.actual_zones,
    pi.ftp_watts,
    pi.run_threshold_pace,
    pi.swim_pace_per_100m
  from app.staff_athletes sa
  join public.workouts w on w.tenant_id = sa.tenant_id
   -- 180 days rather than "everything": CTL is an exponentially weighted average
   -- with a 42-day time constant, so a curve seeded at zero 180 days back has
   -- shed e^(-180/42) ≈ 1.4% of that seed error by today — under one TSB point
   -- against the athlete's own chart, which uses their whole history. Wider is
   -- more faithful and costs rows; this is the trade, stated so it can be moved.
   and w.date >= current_date - p_days
   -- Future planned sessions are excluded because the curve provably never reads
   -- them: extendCurve stops walking at today. Payload only, not a rule change.
   and w.date <= current_date
  left join public.performance_indicators pi on pi.tenant_id = sa.tenant_id
  where sa.staff_id = p_staff_id
  order by sa.tenant_id, w.date;
$$;

-- Cross-tenant by design, so EXECUTE is the only grant — app_writer must never
-- reach the underlying rows directly. The WHERE clause above is the whole
-- authorisation boundary.
revoke all on function app.roster_load(uuid, int) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant execute on function app.roster_load(uuid, int) to app_writer';
  end if;
end $$;

-- Sanity: a staff id with no roster returns no rows rather than erroring.
select count(*) as rows_for_random_staff
  from app.roster_load('00000000-0000-0000-0000-000000000000'::uuid);

select proname, prosecdef as security_definer
  from pg_proc where proname = 'roster_load';
