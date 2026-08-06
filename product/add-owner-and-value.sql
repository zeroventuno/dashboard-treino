-- ────────────────────────────────────────────────────────────────────────────
--  add-owner-and-value.sql — ownership, specialties, and what an athlete is
--  worth per month.
--
--  OWNERSHIP IS A FLAG, NOT A ROLE. In a small agency the founder also coaches,
--  so making "owner" a role would force a choice between running the business
--  and having a roster. `is_owner` sits alongside `role`: a person can be a
--  coach who owns the place, or a nutritionist who owns it, or an owner who
--  doesn't train anyone.
--
--  MONEY: the product deliberately does NOT do the agency's finance — no
--  invoices, no payments, no billing. It stores what the OWNER says an athlete
--  is worth per month, purely so the retention screen can answer the question
--  that actually moves an owner: not "12 at risk" but "12 at risk = R$ 4.680".
--
--  Run once in the product project's SQL Editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────────

alter table app.staff  add column if not exists is_owner boolean not null default false;
-- Which modalities this professional actually programs, e.g. {run,swim}. Empty
-- means "no restriction declared" — the panel reads that as all of them rather
-- than none, so an agency that never fills this in loses nothing.
alter table app.staff  add column if not exists sports   text[] not null default '{}';

alter table app.tenants add column if not exists monthly_value numeric(10,2);
-- One currency per agency: an agency bills in one currency, and putting it on
-- the athlete would invite mixing symbols in the same total.
alter table app.agencies add column if not exists currency text not null default 'BRL';

-- Every agency needs at least one owner, or the macro view is unreachable and
-- nobody can grant it. The founder — the oldest staff row — becomes the owner,
-- but only where no owner exists yet, so re-running never overrides a choice
-- made later in the panel.
update app.staff s
   set is_owner = true
 where s.id in (
   select distinct on (agency_id) id
     from app.staff
    where status = 'active'
    order by agency_id, created_at asc
 )
   and not exists (
     select 1 from app.staff o where o.agency_id = s.agency_id and o.is_owner
   );

-- The runtime role updates these from the panel; it still must never touch
-- api_key_hash or role, so the grants stay column-level.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant update (methodology, is_owner, sports) on app.staff to app_writer';
    execute 'grant update (monthly_value, athlete_name, agency_id) on app.tenants to app_writer';
    execute 'grant insert, delete on app.staff_athletes to app_writer';
    execute 'grant select, update on app.agencies to app_writer';
  end if;
end $$;

select
  (select count(*) from app.staff where is_owner)                as owners,
  (select count(*) from app.tenants where monthly_value is not null) as athletes_priced;
