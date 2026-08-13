-- ────────────────────────────────────────────────────────────────────────────
--  add-athlete-signup.sql — o atleta B2C nasce sozinho, e consegue voltar.
--
--  Hoje um atleta só existe se alguém o cria: pelo painel de uma assessoria ou
--  por script. Para vender direto ao consumidor isso precisa acontecer sem
--  ninguém no meio, e — mais importante — precisa haver caminho de volta.
--
--  DUAS COISAS, UMA MECÂNICA. Cadastro e recuperação são o mesmo objeto: um
--  token de uso único, expirável, guardado como hash, que autoriza exatamente
--  uma ação. O que muda é só o que acontece no resgate:
--
--    signup   → cria o tenant e cunha a chave
--    recover  → ROTACIONA a chave de um tenant que já existe
--
--  Rotacionar, não reenviar, e isso não é escolha de conveniência: a chave
--  original é irrecuperável por construção (só o sha256 é guardado). Uma chave
--  nova é a única resposta honesta a "perdi a minha" — e é também a resposta
--  certa em segurança, porque quem perdeu não sabe se perdeu ou se vazou.
--
--  Rodar uma vez no SQL Editor do projeto de PRODUTO. Re-executável.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists app.athlete_tokens (
  id          uuid primary key default gen_random_uuid(),
  token_hash  text not null unique,
  kind        text not null check (kind in ('signup', 'recover')),
  email       text not null,
  name        text,
  locale      text,
  -- 'signup' preenche no resgate; 'recover' já nasce apontando para o tenant.
  tenant_id   uuid references app.tenants(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);

-- Um token de recuperação tem que saber de quem é; um de cadastro não pode
-- saber, porque o tenant ainda não existe. CHECK que dá NULL PASSA no Postgres,
-- então as duas pontas são escritas explicitamente.
do $$
begin
  if not exists (select 1 where exists (select 1 from pg_constraint where conname = 'athlete_tokens_kind_shape')) then
    alter table app.athlete_tokens add constraint athlete_tokens_kind_shape check (
      (kind = 'recover' and tenant_id is not null)
      or (kind = 'signup')
    );
  end if;
end $$;

create index if not exists athlete_tokens_open
  on app.athlete_tokens (expires_at) where used_at is null;
-- Consultado a cada pedido de recuperação, para não emitir um segundo link
-- enquanto o primeiro ainda vale — senão um formulário público vira um jeito
-- de encher a caixa de e-mail de alguém.
create index if not exists athlete_tokens_recover_open
  on app.athlete_tokens (tenant_id, created_at) where kind = 'recover' and used_at is null;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant select, insert, update on app.athlete_tokens to app_writer';
    -- Cadastro self-service precisa criar tenant sem assessoria. O INSERT em
    -- app.tenants já foi concedido em add-athlete-admin.sql; aqui só falta
    -- poder rotacionar a chave de quem perdeu a dele.
    execute 'grant update (api_key_hash) on app.tenants to app_writer';
  end if;
end $$;

-- Conferência.
select
  (select count(*) from information_schema.tables
    where table_schema='app' and table_name='athlete_tokens')                        as tabela,
  (select count(*) from app.athlete_tokens where used_at is null and expires_at > now()) as tokens_abertos;
