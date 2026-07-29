-- ────────────────────────────────────────────────────────────────────────────
--  add-log-injury-index.sql — unique index so log_injury can UPSERT.
--
--  injury_log had no unique constraint, so re-logging the same injury (same
--  date + body area) would create a duplicate row. Every other write tool
--  upserts to avoid exactly that. This index gives log_injury a conflict target.
--
--  Run once in the product project's SQL Editor. (When the RLS warning appears —
--  the table already exists — click Cancel, then run just this.)
-- ────────────────────────────────────────────────────────────────────────────

create unique index if not exists injury_log_tenant_date_area
  on injury_log (tenant_id, date, area);

-- Confirmation.
select indexname from pg_indexes
where schemaname = 'public' and tablename = 'injury_log' and indexname = 'injury_log_tenant_date_area';
