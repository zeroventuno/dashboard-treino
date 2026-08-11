-- ────────────────────────────────────────────────────────────────────────────
--  add-test-due.sql — when each athlete's thresholds were last measured.
--
--  Every number the product computes hangs off a threshold: zones come from it,
--  the unit a session is prescribed in comes from the zones, time-in-zone is
--  scored against them, and TSS is intensity-over-threshold squared. A threshold
--  measured in March and still in use in September doesn't merely lose accuracy
--  — it makes an athlete who IMPROVED look like they are training easier, because
--  the same effort now sits lower against a number that never moved.
--
--  A coach with sixty athletes cannot hold sixty test dates in their head, so
--  this puts the dates next to the roster they already read every morning.
--
--  A threshold test is logged as a performance_milestone — the same record that
--  already draws the dots on the season timeline — so nothing new is stored.
--  What is missing is a way to READ it across a roster: performance_milestones
--  is RLS-scoped per tenant, and a professional legitimately needs one row per
--  athlete. Same SECURITY DEFINER pattern as app.agency_attention: the function
--  owns the cross-tenant read, and its WHERE clause is the entire authorisation
--  boundary — a professional sees only athletes assigned to them.
--
--  Run once in the product project's SQL Editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function app.roster_test_dates(p_staff_id uuid)
returns table (
  tenant_id     uuid,
  ftp_at        date,
  run_at        date,
  swim_at       date
)
language sql
security definer
set search_path = app, public
as $$
  select
    sa.tenant_id,
    max(m.date) filter (where m.metric = 'FTP')                 as ftp_at,
    max(m.date) filter (where m.metric = 'run_pace_threshold')  as run_at,
    max(m.date) filter (where m.metric = 'swim_pace_100m')      as swim_at
  from app.staff_athletes sa
  left join public.performance_milestones m
    on m.tenant_id = sa.tenant_id
   -- A test scheduled for next week is not a test that happened.
   and m.date <= current_date
  where sa.staff_id = p_staff_id
  group by sa.tenant_id;
$$;

-- The function reads across tenants by design, so EXECUTE is the only grant —
-- app_writer must never be able to select the underlying rows directly.
revoke all on function app.roster_test_dates(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant execute on function app.roster_test_dates(uuid) to app_writer';
  end if;
end $$;

-- Sanity: a staff id with no roster returns no rows rather than erroring.
select count(*) as rows_for_random_staff
  from app.roster_test_dates('00000000-0000-0000-0000-000000000000'::uuid);
