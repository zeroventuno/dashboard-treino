-- ────────────────────────────────────────────────────────────────────────────
--  fix-rls-tenants.sql — "Chave não encontrada" para TODO MUNDO, de repente.
--
--  SINTOMA
--    O SQL Editor lista os tenants normalmente, mas /api/health responde
--    tenants: 0 e nenhuma chave entra — nem a que funcionava ontem.
--
--  CAUSA
--    RLS ligada em app.tenants. Sem policy, ela esconde TODAS as linhas de
--    quem não é superusuário — silenciosamente, sem erro de permissão. O
--    SQL Editor roda como `postgres` e passa por cima, então a tabela parece
--    saudável; o app roda como `app_writer` e enxerga uma tabela vazia.
--
--  POR QUE DESLIGAR É SEGURO AQUI
--    app.tenants vive num schema privado, fora da API pública, e o acesso é
--    controlado por GRANT: o app_writer tem SELECT e nada mais. As tabelas de
--    treino continuam com RLS ligada e escopo por current_setting('app.tenant_id')
--    — é lá que o isolamento entre atletas acontece. Ligar RLS aqui não protege
--    nada e quebra a autenticação de todo mundo.
--
--    Cuidado: o botão "Enable RLS" que o Supabase oferece nos avisos de
--    segurança atinge esta tabela também. É a origem mais provável.
-- ────────────────────────────────────────────────────────────────────────────

alter table app.tenants disable row level security;

-- Confirmação. Esperado: rls_ligada = false, e o total de contas > 0.
select
  (select relrowsecurity from pg_class where oid = 'app.tenants'::regclass) as rls_ligada,
  (select count(*) from app.tenants)                                        as contas,
  has_table_privilege('app_writer', 'app.tenants', 'select')                as app_writer_le;

-- Depois: recarregue https://trakdash.vercel.app/api/health
-- Deve responder {"db":"ok","tenants":N} com N > 0.
