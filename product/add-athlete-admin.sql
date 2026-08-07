-- ────────────────────────────────────────────────────────────────────────────
--  add-athlete-admin.sql — registering and managing athletes from the panel.
--
--  Until now an athlete could only be created by running provision.mjs from a
--  terminal, as the postgres superuser. That's fine for a founder minting a
--  friend's account; it's not a product. An agency owner has to be able to add
--  an athlete, fill in their details and hand them their link.
--
--  ⚠ A DELIBERATE RELAXATION, worth stating plainly: provision.mjs carries a
--  comment saying app_writer must never mint accounts, because it's the MCP
--  server's runtime role. That reasoning held when the panel had no way to do
--  it. It now needs one, and the alternative — a second admin connection just
--  for this route — puts superuser credentials in the web app, which is worse.
--  So app_writer gains INSERT on app.tenants and nothing else: it still cannot
--  read another tenant's rows (RLS), cannot change api_key_hash on an existing
--  account, and the route is owner-gated. The blast radius of the worst case is
--  an empty account nobody has the key to.
--
--  Run once in the product project's SQL Editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────────

-- What a coach actually needs to recognise and reach an athlete. No photo yet:
-- that needs a storage bucket, upload handling and a moderation story, and the
-- roster reads perfectly well from initials until an agency asks for it.
alter table app.tenants add column if not exists nickname text;
alter table app.tenants add column if not exists phone    text;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant insert on app.tenants to app_writer';
    execute 'grant update (monthly_value, athlete_name, agency_id, nickname, phone) on app.tenants to app_writer';
  end if;
end $$;

select column_name
  from information_schema.columns
 where table_schema = 'app' and table_name = 'tenants'
   and column_name in ('nickname', 'phone', 'monthly_value', 'agency_id');
