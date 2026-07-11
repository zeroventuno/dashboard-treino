-- ────────────────────────────────────────────────────────────────────────────
--  Runtime DB role for the MCP server (and later the dashboard read path).
--  NOT a superuser → RLS is ENFORCED. This is what makes tenant isolation real:
--  the migration ran as `postgres` (bypasses RLS, fine for seeding), but every
--  request at runtime must go through this role so a tenant can only ever touch
--  its own rows.
--
--  Run in the product project's SQL Editor. CHANGE THE PASSWORD first.
-- ────────────────────────────────────────────────────────────────────────────

create role app_writer login password 'CHANGE-ME-TO-A-STRONG-PASSWORD';

-- Schema + table access.
grant usage on schema app, public to app_writer;
grant select on app.tenants to app_writer;                       -- auth lookup only (by api_key_hash)
grant select, insert, update, delete on all tables in schema public to app_writer;

-- Cover any tables added later, too.
alter default privileges in schema public
  grant select, insert, update, delete on tables to app_writer;

-- Sanity check: app_writer must NOT be superuser and must NOT bypass RLS.
--   select rolname, rolsuper, rolbypassrls from pg_roles where rolname = 'app_writer';
--   → rolsuper = false, rolbypassrls = false
--
-- The MCP server then connects as:
--   postgresql://app_writer:<password>@db.<project-ref>.supabase.co:5432/postgres
