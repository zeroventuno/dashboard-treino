-- ────────────────────────────────────────────────────────────────────────────
--  add-agency-provisioning.sql — nascer uma assessoria sem abrir o SQL Editor.
--
--  Hoje `app.agencies` e o primeiro `staff` só existem rodando o template do
--  add-b2b-staff.sql à mão como `postgres`. Isso significa que quem "vende" o
--  produto é o Rafael com o editor aberto: funciona nos primeiros clientes e
--  trava no terceiro.
--
--  UMA TRANSAÇÃO, e é o ponto inteiro da função: uma assessoria sem dono é
--  inalcançável (ninguém pode conceder posse, porque conceder posse é ato de
--  dono), então criar a agência e falhar no staff deixaria uma linha morta que
--  só o Rafael consegue limpar — de novo no SQL Editor, de novo o problema que
--  esta migração existe para resolver.
--
--  A CHAVE NÃO NASCE AQUI. O app sorteia o `trakc_…`, guarda só o sha256 e
--  mostra o texto UMA vez — mesmo tratamento que a chave do atleta já recebe em
--  /coach/athletes. Uma função que devolvesse a chave em texto a deixaria no log
--  de statements do Postgres, que é exatamente onde uma credencial não pode
--  estar.
--
--  Rodar uma vez no SQL Editor do projeto de PRODUTO. Re-executável.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function app.provision_agency(
  p_agency_name text,
  p_currency    text,
  p_owner_name  text,
  p_owner_email text,
  p_key_hash    text
)
returns table (agency_id uuid, staff_id uuid)
language plpgsql
security definer
set search_path = app, public
as $$
declare
  v_agency uuid;
  v_staff  uuid;
begin
  if coalesce(trim(p_agency_name), '') = '' then
    raise exception 'agency name is required';
  end if;
  -- 64 hex do sha256. Barra na entrada um chamador que passe a chave em texto
  -- por engano — que gravaria uma credencial legível como se fosse um hash.
  if p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'key hash must be a sha256 hex digest';
  end if;
  if exists (select 1 from app.staff where api_key_hash = p_key_hash) then
    raise exception 'key already in use';
  end if;

  insert into app.agencies (name, currency, status)
  values (trim(p_agency_name), coalesce(nullif(trim(p_currency), ''), 'BRL'), 'active')
  returning id into v_agency;

  -- O primeiro profissional é dono por definição: sem isso a assessoria nasce
  -- sem ninguém que possa administrá-la.
  insert into app.staff (agency_id, name, email, role, status, is_owner, api_key_hash)
  values (v_agency, nullif(trim(p_owner_name), ''), nullif(trim(p_owner_email), ''),
          'coach', 'active', true, p_key_hash)
  returning id into v_staff;

  agency_id := v_agency;
  staff_id  := v_staff;
  return next;
end;
$$;

-- O app (app_writer) chama; a função é segura porque não recebe nem devolve
-- credencial, e cria exatamente uma agência com exatamente um dono.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant execute on function app.provision_agency(text,text,text,text,text) to app_writer';
  end if;
end $$;

-- Conferência.
select proname, prosecdef as security_definer
  from pg_proc where proname = 'provision_agency';
