-- ────────────────────────────────────────────────────────────────────────────
--  add-anatomy.sql — profile field that picks the body figure in the strength
--  map (male | female). Run once in the product project's SQL Editor.
--
--  The muscle-highlighter library ships both figures; this says which one to
--  render. It's the body drawing, not gender identity — the coach asks which
--  figure the athlete prefers to see.
-- ────────────────────────────────────────────────────────────────────────────

alter table profiles
  add column if not exists anatomy text not null default 'male';

-- Confirmation.
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'anatomy';
