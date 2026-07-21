-- ────────────────────────────────────────────────────────────────────────────
--  provision.sql — criar um tenant pelo SQL Editor do Supabase.
--
--  Mesma coisa que provision.mjs, sem precisar de connection string: o SQL
--  Editor já roda como `postgres`, então não há senha para errar nem pooler
--  para acertar. Útil quando a conexão local está brigando (28P01) ou para
--  provisionar de qualquer máquina.
--
--  COMO USAR
--    1. Abra o SQL Editor do projeto de PRODUTO (confira o ref na URL!).
--    2. Troque o e-mail e o nome nas duas linhas marcadas abaixo.
--    3. Rode. A chave aparece UMA VEZ no resultado — copie antes de fechar.
--
--  A chave é armazenada apenas como sha256, idêntico ao que provision.mjs faz
--  (verificado: o digest do Postgres bate byte a byte com o do Node, que é o
--  que o servidor MCP usa para autenticar).
-- ────────────────────────────────────────────────────────────────────────────

with novo as (
  -- 'trak_' + 24 bytes aleatórios em hex = mesmo formato do provision.mjs
  select 'trak_' || encode(extensions.gen_random_bytes(24), 'hex') as account_key
), criado as (
  insert into app.tenants (email, status, plan, api_key_hash)
  select
    'amigo@exemplo.com',                                    -- ← E-MAIL DO AMIGO
    'trialing', 'free',
    encode(extensions.digest(account_key, 'sha256'), 'hex')
  from novo
  returning id
), perfil as (
  -- perfil inicial; o coach refina via set_profile durante a descoberta
  insert into profiles (tenant_id, athlete, mode)
  select id,
    'Nome do Amigo',                                        -- ← NOME DO AMIGO
    'race'
  from criado
  on conflict (tenant_id) do nothing
  returning tenant_id
)
select
  (select id from criado)          as tenant_id,
  (select account_key from novo)   as chave_da_conta,       -- ← COPIE ISTO
  (select count(*) from perfil)    as perfil_criado;

-- ────────────────────────────────────────────────────────────────────────────
--  Depois de rodar, envie ao atleta (trocando <CHAVE> pelo valor acima):
--
--    1) Claude Desktop → Settings → Connectors → Add custom connector:
--         Name: TRAK Coach
--         URL:  https://<mcp-host>/api/mcp?key=<CHAVE>
--       Reiniciar o app; as ferramentas do coach aparecem.
--
--    2) Painel: https://treino-costanavarino.vercel.app/app?key=<CHAVE>
--
--    3) Pedir ao coach: "liste meus aparelhos e o que cada um mede", e
--       registrar o check-in de hoje.
--
--  Conferir depois:  select email, created_at from app.tenants order by created_at desc;
-- ────────────────────────────────────────────────────────────────────────────
