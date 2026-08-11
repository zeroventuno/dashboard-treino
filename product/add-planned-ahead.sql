-- ────────────────────────────────────────────────────────────────────────────
--  add-planned-ahead.sql — who has nothing on the calendar.
--
--  This is the failure a coaching business dies of, and the one nobody sees.
--  With sixty athletes, somebody ends up with an empty week — a handover missed,
--  a block that ran out, an athlete the batch prescription silently skipped —
--  and nothing surfaces it. The athlete opens their dashboard, finds nothing,
--  waits a few days, and leaves. The retention screen then reports it as a
--  drop-off weeks later, which is a post-mortem, not a warning.
--
--  Everything needed to catch it beforehand is already in the database.
--
--  Counts only what the athlete is actually expected to do: `planned` sessions
--  from today onward. Done, skipped, cancelled and moved are all history or
--  explicitly off the plan, and counting them would keep a card green on the
--  strength of last week's work.
--
--  Run once in the product project's SQL Editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function app.roster_planned_ahead(p_staff_id uuid)
returns table (
  tenant_id     uuid,
  planned_7d    int,
  planned_14d   int,
  last_planned  date
)
language sql
security definer
set search_path = app, public
as $$
  select
    sa.tenant_id,
    count(*) filter (
      where w.status = 'planned' and w.date between current_date and current_date + 7
    )::int as planned_7d,
    count(*) filter (
      where w.status = 'planned' and w.date between current_date and current_date + 14
    )::int as planned_14d,
    -- How far the plan actually reaches. A coach reading "0 in 7 days" wants to
    -- know whether the block ended yesterday or three weeks ago.
    max(w.date) filter (where w.status = 'planned' and w.date >= current_date) as last_planned
  from app.staff_athletes sa
  left join public.workouts w on w.tenant_id = sa.tenant_id
  where sa.staff_id = p_staff_id
  group by sa.tenant_id;
$$;

-- Cross-tenant by design, so EXECUTE is the only grant — app_writer must never
-- reach the underlying rows directly. The WHERE clause above is the whole
-- authorisation boundary: a professional sees only their own roster.
revoke all on function app.roster_planned_ahead(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant execute on function app.roster_planned_ahead(uuid) to app_writer';
  end if;
end $$;

select proname, prosecdef as security_definer
  from pg_proc where proname = 'roster_planned_ahead';
