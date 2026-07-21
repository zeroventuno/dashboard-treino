-- ────────────────────────────────────────────────────────────────────────────
--  diagnose-key.sql — "Chave não encontrada" no /app, mas o tenant foi criado.
--
--  Rode no SQL Editor do MESMO projeto onde você rodou o provision.sql.
--  Troque a chave abaixo pela do atleta.
-- ────────────────────────────────────────────────────────────────────────────

with entrada as (
  select 'trak_34aaff97ae7c94eb32782b695603fe957f2b5ed8a8e23901' as chave   -- ← A CHAVE
), calc as (
  select chave, encode(extensions.digest(chave, 'sha256'), 'hex') as hash from entrada
)
select
  -- 1. Este projeto conhece essa chave?
  exists (select 1 from app.tenants t, calc c where t.api_key_hash = c.hash)
    as chave_existe_aqui,

  -- 2. O app rejeita status 'canceled'; qualquer outro serve.
  (select t.status from app.tenants t, calc c where t.api_key_hash = c.hash)
    as status,

  -- 3. RLS ligada em app.tenants esconde TODAS as linhas do app_writer,
  --    silenciosamente — sem erro de permissão.
  (select relrowsecurity from pg_class
    where oid = 'app.tenants'::regclass) as rls_ligada_bloqueia_tudo,

  -- 4. O papel do app consegue ler a tabela?
  has_table_privilege('app_writer', 'app.tenants', 'select') as app_writer_le,

  -- 5. Quantas contas existem neste banco (a sua + a do amigo = 2)?
  (select count(*) from app.tenants) as total_de_contas,

  -- 6. Em qual projeto estamos? Compare com o ref da PRODUCT_DATABASE_URL
  --    configurada na Vercel — se forem diferentes, é essa a causa.
  current_database() as banco,
  (select setting from pg_settings where name = 'cluster_name') as cluster
from calc;

-- Listagem das contas, para ver se a do amigo está mesmo aqui:
select email, status, created_at
from app.tenants
order by created_at desc;
