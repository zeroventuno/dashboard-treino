-- Lets the dashboard resolve an account API key → tenant_id without exposing the
-- private app.tenants table. SECURITY DEFINER runs as the owner (which can read
-- app.tenants); callers only ever pass a sha256 hash and get back a uuid.
-- Run once in the product project's SQL Editor.

create or replace function public.resolve_tenant(key_hash text)
returns uuid
language sql
security definer
set search_path = app, public
as $$
  select id from app.tenants
  where api_key_hash = key_hash and status <> 'canceled'
  limit 1;
$$;

grant execute on function public.resolve_tenant(text) to service_role, anon, authenticated;
