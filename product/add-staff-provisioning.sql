-- ────────────────────────────────────────────────────────────────────────────
--  add-staff-provisioning.sql — let the coach panel add professionals to its own
--  agency (Settings → Equipe) without hand-written SQL. The app_writer role
--  already SELECTs app.staff and UPDATEs its methodology; this adds INSERT so the
--  panel can create a staff row (with a generated trakc_ key hash). Authorization
--  is enforced in the app layer (only the authenticated coach's agency).
--
--  Also grant staff_athletes INSERT/DELETE so the panel can link/unlink athletes
--  to a professional (roster assignment).
--
--  Run once in the product project's SQL Editor.
-- ────────────────────────────────────────────────────────────────────────────

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant insert on app.staff to app_writer';
    execute 'grant insert, delete on app.staff_athletes to app_writer';
  end if;
end $$;

-- Confirmation: app_writer's privileges on app.staff.
select privilege_type
from information_schema.role_table_grants
where grantee = 'app_writer' and table_schema = 'app' and table_name = 'staff'
order by privilege_type;
