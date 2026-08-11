-- ────────────────────────────────────────────────────────────────────────────
--  add-agency-management.sql — o que falta para o painel-mãe da assessoria.
--
--  Três coisas que o produto já queria medir e não tinha onde guardar:
--
--  1. CAPACIDADE. O roster já se conta sozinho, mas contar não diz nada sem um
--     alvo: 40 alunos é folga para um treinador e afogamento para outro. Fica
--     NULO por padrão de propósito — assessoria que nunca preencher isso não
--     perde nada, só não vê a barra de ocupação.
--
--  2. CUSTO. `tenants.monthly_value` guarda a RECEITA por aluno desde a fase 2;
--     não existia nenhum dado do outro lado da conta, então margem era
--     incalculável. Rafael: "ainda não sei / varia" — daí os três formatos, e
--     não o que eu teria chutado. `pay_model` nulo mantém custo e margem NULOS
--     em vez de zero: zero é uma afirmação (margem = receita inteira) e seria
--     mentira. Mesma regra do resto da casa — recusar vale mais que fingir.
--
--  3. METODOLOGIA DA CASA. `staff.methodology` já existe, mas POR PROFISSIONAL:
--     hoje uma assessoria com 6 treinadores tem 6 escolas com a mesma logo. A da
--     agência passa a ser lida primeiro e a do treinador por cima — a casa tem
--     um jeito de treinar e cada um ainda tem voz dentro dele.
--
--  O dinheiro segue deliberadamente estreito: o produto NÃO faz financeiro
--  (sem cobrança, sem nota, sem fluxo de caixa). Guarda o suficiente para
--  responder "esse treinador dá lucro?" e nada além disso.
--
--  Rodar uma vez no SQL Editor do projeto de PRODUTO. Re-executável.
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Capacidade
alter table app.staff add column if not exists max_athletes int
  check (max_athletes is null or max_athletes > 0);

-- 2. Custo
--    pct         → pay_value é % do que o aluno paga (ex.: 60 = 60/40)
--    per_athlete → pay_value é valor fixo por aluno ativo
--    salary      → pay_value é o mensal fixo, independente da carteira
alter table app.staff add column if not exists pay_model text
  check (pay_model is null or pay_model in ('pct','per_athlete','salary'));
alter table app.staff add column if not exists pay_value numeric(10,2)
  check (pay_value is null or pay_value >= 0);

-- Um modelo sem valor não calcula nada e um valor sem modelo não significa
-- nada — os dois juntos ou nenhum. CHECK que dá NULL PASSA no Postgres, então
-- as duas pontas precisam estar escritas explicitamente.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_pay_complete') then
    alter table app.staff add constraint staff_pay_complete check (
      (pay_model is null and pay_value is null)
      or (pay_model is not null and pay_value is not null)
    );
  end if;
end $$;

-- Percentual é 0-100. Sem isto, alguém digita 0.6 querendo 60% e a margem sai
-- ~100% — errada de um jeito que parece plausível, que é o pior tipo.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'staff_pay_pct_range') then
    alter table app.staff add constraint staff_pay_pct_range check (
      pay_model is distinct from 'pct' or (pay_value >= 0 and pay_value <= 100)
    );
  end if;
end $$;

-- 3. Metodologia da casa
alter table app.agencies add column if not exists methodology jsonb not null default '{}';

-- O runtime (app_writer) edita isto pelo painel do dono; segue sem poder tocar
-- api_key_hash nem role, por isso o grant continua por coluna.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant update (methodology, is_owner, sports, max_athletes, pay_model, pay_value) on app.staff to app_writer';
    execute 'grant select, update on app.agencies to app_writer';
  end if;
end $$;

-- Conferência.
select
  (select count(*) from information_schema.columns
    where table_schema='app' and table_name='staff'
      and column_name in ('max_athletes','pay_model','pay_value'))            as colunas_staff,   -- esperado 3
  (select count(*) from information_schema.columns
    where table_schema='app' and table_name='agencies' and column_name='methodology') as metodologia_agencia, -- 1
  (select count(*) from app.staff where pay_model is not null)                as com_modelo_de_pagamento,
  (select count(*) from app.staff where max_athletes is not null)             as com_capacidade;
