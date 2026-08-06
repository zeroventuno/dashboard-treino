-- ────────────────────────────────────────────────────────────────────────────
--  add-agency-attention.sql — the retention signal behind the agency's
--  "needs attention" list.
--
--  An agency owner rarely notices churn while it's still reversible: the athlete
--  who trained five times a week and now trains once is still paying, still on
--  the roster, and invisible in any headcount. So this returns, per athlete, the
--  raw engagement facts — last check-in, last completed session, and sessions
--  done in the last 14 days versus the 14 before that. The comparison is the
--  point: a snapshot ("no check-in for 10 days") flags people who were always
--  sporadic, while the drop flags the ones worth calling today.
--
--  SECURITY DEFINER for the same reason as app.roster_summary: app_writer runs
--  under RLS and can't read across tenants. The join to app.tenants.agency_id is
--  the authorization boundary — an agency only ever sees its own athletes.
--
--  Run once in the product project's SQL Editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────────

drop function if exists app.agency_attention(uuid);

create function app.agency_attention(p_agency uuid)
returns table (
  tenant_id     uuid,
  name          text,
  email         text,
  created_at    timestamptz,
  last_checkin  date,
  last_done     date,
  done_recent   int,   -- completed sessions, last 14 days
  done_prev     int,   -- completed sessions, the 14 days before those
  checkins_recent int, -- check-ins in the last 14 days (engagement ≠ training)
  monthly_value numeric,
  staff         text[],
  staff_ids     uuid[]  -- lets the panel narrow the same rows to one professional
)
language sql
security definer
set search_path = app, public
as $$
  select
    t.id,
    coalesce(t.athlete_name, t.email)                                   as name,
    t.email,
    t.created_at,
    (select max(c.date) from public.checkins c where c.tenant_id = t.id) as last_checkin,
    (select max(w.date) from public.workouts w
      where w.tenant_id = t.id and w.status = 'done')                    as last_done,
    (select count(*) from public.workouts w
      where w.tenant_id = t.id and w.status = 'done'
        and w.date >  current_date - 14)::int                            as done_recent,
    (select count(*) from public.workouts w
      where w.tenant_id = t.id and w.status = 'done'
        and w.date >  current_date - 28
        and w.date <= current_date - 14)::int                            as done_prev,
    (select count(*) from public.checkins c
      where c.tenant_id = t.id and c.date > current_date - 14)::int      as checkins_recent,
    t.monthly_value,
    coalesce(array_agg(distinct s.name) filter (where s.name is not null), '{}') as staff,
    coalesce(array_agg(distinct s.id)   filter (where s.id   is not null), '{}') as staff_ids
  from app.tenants t
  left join app.staff_athletes sa on sa.tenant_id = t.id
  left join app.staff s on s.id = sa.staff_id and s.status = 'active'
  where t.agency_id = p_agency
  group by t.id, t.athlete_name, t.email, t.created_at, t.monthly_value
$$;

-- The MCP/runtime role executes it; the function body does the cross-tenant read.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant execute on function app.agency_attention(uuid) to app_writer';
  end if;
end $$;

select count(*) as athletes_visible from app.agency_attention(
  (select id from app.agencies limit 1)
);
