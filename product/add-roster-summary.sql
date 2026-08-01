-- ────────────────────────────────────────────────────────────────────────────
--  add-roster-summary.sql — the coach panel's team view in ONE query.
--
--  The dashboard connects as app_writer (RLS enforced), so it can't read across
--  many tenants at once — RLS scopes every query to a single app.tenant_id. The
--  roster view needs a summary row PER athlete, so instead of N transactions we
--  use a SECURITY DEFINER function: it runs as the owner (bypassing RLS) but is
--  scoped by the staff_athletes join, so it can only ever return athletes that
--  belong to the staff member you pass in. Same pattern as public.resolve_tenant.
--
--  Run once in the product project's SQL Editor, as postgres.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function app.roster_summary(p_staff uuid)
returns table (
  tenant_id       uuid,
  name            text,
  athlete         text,
  mode            text,
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
    r.name                                          as next_race_name,
    r.date                                          as next_race_date,
    ci.recommendation                               as today_reco,
    lc.last_checkin,
    coalesce(inj.recent_injuries, 0)                as recent_injuries
  from app.staff_athletes sa
  join app.tenants t on t.id = sa.tenant_id
  left join public.profiles p on p.tenant_id = t.id
  -- next A-race, else soonest upcoming
  left join lateral (
    select name, date from public.races
     where tenant_id = t.id and date >= current_date
     order by (priority = 'A') desc, date asc
     limit 1
  ) r on true
  -- today's traffic-light, if they checked in
  left join lateral (
    select recommendation from public.checkins
     where tenant_id = t.id and date = current_date
     limit 1
  ) ci on true
  -- most recent check-in of any day (to flag "no check-in in N days")
  left join lateral (
    select max(date) as last_checkin from public.checkins where tenant_id = t.id
  ) lc on true
  -- injuries logged in the last 30 days (a rough "watch this" flag)
  left join lateral (
    select count(*)::int as recent_injuries from public.injury_log
     where tenant_id = t.id and date >= current_date - 30
  ) inj on true
  where sa.staff_id = p_staff
  order by name;
$$;

-- The dashboard (app_writer) calls it; it's safe because the function filters by
-- the staff id the caller passes, which comes from the authenticated cookie.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant execute on function app.roster_summary(uuid) to app_writer';
  end if;
end $$;

-- Confirmation.
select proname, prosecdef as security_definer
from pg_proc where proname = 'roster_summary';
