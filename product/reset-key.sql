-- ────────────────────────────────────────────────────────────────────────────
--  reset-key.sql — gerar uma chave nova para um atleta existente.
--
--  Use quando a chave se perdeu, vazou (print, e-mail) ou não está autenticando.
--
--  UMA QUERY SÓ, e isso é a correção de um defeito real. A versão anterior era
--  em dois passos, com a chave colada como literal no segundo. Rodando o
--  arquivo inteiro — que é o que qualquer pessoa faz no editor do Supabase —
--  duas coisas davam errado ao mesmo tempo:
--
--    · o editor mostra apenas o ÚLTIMO resultado, então a chave gerada no
--      passo 1 nunca aparecia; o que se via era o `id` do passo 2;
--    · e o passo 2 gravava o hash do texto literal "COLE_A_CHAVE_AQUI",
--      deixando a conta com uma chave que ninguém conhece.
--
--  Nada disso avisava. Agora não há o que colar e não há ordem para errar.
--
--  O CTE é MATERIALIZED de propósito: sem isso o Postgres pode avaliar
--  `gen_random_bytes` mais de uma vez, e a chave gravada no hash sairia
--  diferente da chave devolvida — o mesmo erro que os dois passos tentavam
--  evitar, resolvido onde ele de fato mora.
--
--  Trocar a chave INVALIDA a anterior na hora. É assim que se revoga acesso.
-- ────────────────────────────────────────────────────────────────────────────

with nova as materialized (
  select 'trak_' || encode(extensions.gen_random_bytes(24), 'hex') as chave
)
update app.tenants t
   set api_key_hash = encode(extensions.digest(nova.chave, 'sha256'), 'hex')
  from nova
 where lower(t.email) = lower('amigo@exemplo.com')   -- ← TROQUE PELO E-MAIL DO ATLETA
returning
  nova.chave        as chave_nova,   -- ← É ESTA que você envia
  t.email,
  t.status,
  -- Precisa vir 'active'. resolveTenantId aceita qualquer status EXCETO
  -- 'canceled', então uma conta cancelada é o único caso em que a chave
  -- correta ainda assim não entra.
  t.api_key_hash = encode(extensions.digest(nova.chave, 'sha256'), 'hex') as confere;

-- Zero linhas devolvidas = o e-mail não bateu. Nada foi alterado; confira o
-- endereço com:  select email, status from app.tenants order by created_at;
--
-- Depois de enviar:
--   Painel:    https://mytrakr.fit/app?key=<CHAVE>
--   Conector:  https://dashboard-treino-zeroventunos-projects.vercel.app/api/mcp?key=<CHAVE>
--
-- Se o atleta já tinha o conector instalado com a chave antiga, precisa
-- REMOVER e adicionar de novo — os clientes cacheiam a lista de ferramentas.
