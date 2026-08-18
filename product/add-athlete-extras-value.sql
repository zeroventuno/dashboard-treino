-- ────────────────────────────────────────────────────────────────────────────
--  add-athlete-extras-value.sql — the slice of an athlete's fee that isn't
--  coaching.
--
--  `monthly_value` stays what the athlete pays in total. This adds ONE more
--  number, `monthly_value_extras`: how much of that total is physio and/or
--  nutrition, so a treinador's book and the agency's "extras" aren't the same
--  figure counted twice. Deliberately a single combined field, not one column
--  per service — the tool isn't trying to be a financial system, just letting
--  an owner separate "training" from "everything else" at a glance.
--
--  Nothing reads this column yet outside of what stores and displays it — it
--  doesn't change any existing total, KPI, or scoreboard math. Wiring it into
--  the revenue split is a later, separate decision.
--
--  Run once in the product project's SQL Editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────────

alter table app.tenants add column if not exists monthly_value_extras numeric(10,2);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant update (monthly_value_extras) on app.tenants to app_writer';
  end if;
end $$;

select count(*) as athletes_with_extras from app.tenants where monthly_value_extras is not null;
