-- ────────────────────────────────────────────────────────────────────────────
--  reset-key.sql — gerar uma chave nova para um tenant existente.
--
--  Use quando a chave se perdeu, vazou (print, e-mail, captura de tela) ou
--  simplesmente não está autenticando.
--
--  Deliberadamente em DOIS PASSOS, com a chave colada como literal no passo 2.
--  O provision.sql gera e grava numa query só, o que é conveniente mas depende
--  de o CTE que sorteia a chave ser avaliado uma única vez; aqui não há o que
--  dar errado, porque a chave que você cola é exatamente a que vira hash.
--
--  Trocar a chave INVALIDA a anterior na hora, tanto no painel quanto no
--  conector do coach — é assim que se revoga um acesso.
-- ────────────────────────────────────────────────────────────────────────────


-- ── PASSO 1 ── gere a chave e COPIE o resultado ─────────────────────────────

select 'trak_' || encode(extensions.gen_random_bytes(24), 'hex') as chave_nova;


-- ── PASSO 2 ── cole a chave nos DOIS lugares marcados e rode ────────────────

update app.tenants
   set api_key_hash = encode(extensions.digest('COLE_A_CHAVE_AQUI', 'sha256'), 'hex')
 where email = 'amigo@exemplo.com'                       -- ← E-MAIL DO ATLETA
returning
  id,
  email,
  status,
  -- confirmação de que o que ficou gravado corresponde à chave que você vai
  -- enviar; se vier false, não envie nada e rode de novo
  api_key_hash = encode(extensions.digest('COLE_A_CHAVE_AQUI', 'sha256'), 'hex')
    as chave_confere;


-- ── PASSO 3 ── só então envie ao atleta ─────────────────────────────────────
--
--   Conector:  https://dashboard-treino-zeroventunos-projects.vercel.app/api/mcp?key=<CHAVE>
--   Painel:    https://trakdash.vercel.app/app?key=<CHAVE>
--
--  Se o atleta já tinha o conector instalado com a chave antiga, ele precisa
--  removê-lo e adicioná-lo de novo — os clientes cacheiam a configuração.
-- ────────────────────────────────────────────────────────────────────────────
