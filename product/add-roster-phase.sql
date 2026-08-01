-- ────────────────────────────────────────────────────────────────────────────
--  add-roster-phase.sql — add the athlete's CURRENT training phase to the roster
--  summary, so the coach can group/filter their squad into cohorts (everyone in
--  Base, everyone in Build, …) — the unit of batch prescription.
--
--  The phase is derived from the active training_cycle: walk its phases jsonb
--  ([{name, weeks, focus}]) from start_date and find which one today falls in.
--
--  Changing the return columns means DROP + CREATE (create-or-replace can't add
--  OUT columns). Re-runnable. Run once in the product project's SQL Editor.
-- ────────────────────────────────────────────────────────────────────────────

drop function if exists app.roster_summary(uuid);

create function app.roster_summary(p_staff uuid)
returns table (
  tenant_id       uuid,
  name            text,
  athlete         text,
  mode            text,
  current_phase   text,
  sports          text[],
  metrics         text[],
  next_race_name  text,
  next_race_date  date,
  today_reco      text,
  last_checkin    date,
  recent_injuries int
)
language sql
security definer
set search_path = app, public
as $$
  select
    t.id,
    coalesce(t.athlete_name, t.email)               as name,
    p.athlete,
    p.mode,
    -- Which phase of the active cycle is today in? cum_end is the running total
    -- of weeks; cum_start = cum_end - this phase's weeks. Today's week-offset
    -- from the cycle start picks the row. Null when there's no active cycle, or
    -- today is before it starts / after it ends.
    (
      select e.name
      from public.training_cycles tc,
           lateral (
             select
               elem->>'name' as name,
               sum((elem->>'weeks')::int) over (order by ord) as cum_end,
               sum((elem->>'weeks')::int) over (order by ord) - (elem->>'weeks')::int as cum_start
             from jsonb_array_elements(tc.phases) with ordinality as arr(elem, ord)
           ) e
      where tc.tenant_id = t.id and tc.active
        and ((current_date - tc.start_date) / 7) >= e.cum_start
        and ((current_date - tc.start_date) / 7) <  e.cum_end
      order by e.cum_start
      limit 1
    )                                               as current_phase,
    -- Which disciplines this athlete actually trains (for the modality icons).
    coalesce(
      (select array_agg(distinct discipline order by discipline)
         from public.workouts
        where tenant_id = t.id and discipline is not null and discipline <> 'rest'),
      '{}'
    )                                               as sports,
    coalesce(p.metrics, '{}')                       as metrics,
    r.name                                          as next_race_name,
    r.date                                          as next_race_date,
    ci.recommendation                               as today_reco,
    lc.last_checkin,
    coalesce(inj.recent_injuries, 0)                as recent_injuries
  from app.staff_athletes sa
  join app.tenants t on t.id = sa.tenant_id
  left join public.profiles p on p.tenant_id = t.id
  left join lateral (
    select name, date from public.races
     where tenant_id = t.id and date >= current_date
     order by (priority = 'A') desc, date asc
     limit 1
  ) r on true
  left join lateral (
    select recommendation from public.checkins
     where tenant_id = t.id and date = current_date
     limit 1
  ) ci on true
  left join lateral (
    select max(date) as last_checkin from public.checkins where tenant_id = t.id
  ) lc on true
  left join lateral (
    select count(*)::int as recent_injuries from public.injury_log
     where tenant_id = t.id and date >= current_date - 30
  ) inj on true
  where sa.staff_id = p_staff
  order by name;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant execute on function app.roster_summary(uuid) to app_writer';
  end if;
end $$;

select proname from pg_proc where proname = 'roster_summary';
