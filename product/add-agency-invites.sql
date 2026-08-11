-- ────────────────────────────────────────────────────────────────────────────
--  add-agency-invites.sql — o convite de uso único que vira uma assessoria.
--
--  O convite guarda a INTENÇÃO (nome da assessoria, e-mail do dono), não a
--  assessoria. Ela só nasce quando alguém clica e confirma — assim um convite
--  que ninguém abre não deixa uma agência órfã no banco, e a chave `trakc_` é
--  sorteada no instante em que é mostrada, em vez de existir semanas esperando
--  dentro de um e-mail.
--
--  O TOKEN É GUARDADO COMO HASH, pelo mesmo motivo que as chaves de API: quem
--  lê o banco não pode conseguir entrar. Um convite vazado daria a posse de uma
--  assessoria inteira.
--
--  USO ÚNICO garantido pelo banco, não pelo app: a reivindicação é um UPDATE
--  condicional (`used_at is null`) que devolve linha só na primeira vez. Dois
--  cliques simultâneos — o do dono e o do antivírus do provedor de e-mail que
--  abre links para checá-los — não podem criar duas assessorias.
--
--  Rodar uma vez no SQL Editor do projeto de PRODUTO. Re-executável.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists app.agency_invites (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique,
  agency_name text not null,
  owner_name  text,
  owner_email text,
  currency    text not null default 'BRL',
  created_at  timestamptz not null default now(),
  -- Convite não é credencial permanente: se ficou parado, virou risco.
  expires_at  timestamptz not null default now() + interval '14 days',
  used_at     timestamptz,
  -- Preenchido no resgate: o rastro de qual convite gerou qual assessoria.
  agency_id   uuid references app.agencies(id) on delete set null
);

create index if not exists agency_invites_open
  on app.agency_invites (expires_at) where used_at is null;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant select, insert, update on app.agency_invites to app_writer';
  end if;
end $$;

-- Conferência.
select
  (select count(*) from information_schema.tables
    where table_schema='app' and table_name='agency_invites') as tabela,
  (select count(*) from app.agency_invites where used_at is null and expires_at > now()) as convites_abertos;
