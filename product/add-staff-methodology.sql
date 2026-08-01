-- ────────────────────────────────────────────────────────────────────────────
--  add-staff-methodology.sql — a professional's training philosophy / working
--  method, stored once so their AI copilot drafts on-brand and stops re-asking.
--  jsonb so the shape can grow (philosophy, sports, periodization, 80/20, has a
--  workout bank, default weekly structure, free notes…) without a migration.
--
--  Run once in the product project's SQL Editor.
-- ────────────────────────────────────────────────────────────────────────────

alter table app.staff add column if not exists methodology jsonb not null default '{}';

-- The MCP server (app_writer) writes it via set_methodology. Column-level grant
-- so app_writer can update the methodology but never the api_key_hash/role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant update (methodology) on app.staff to app_writer';
  end if;
end $$;

select column_name, data_type from information_schema.columns
where table_schema = 'app' and table_name = 'staff' and column_name = 'methodology';
