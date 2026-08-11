-- ───────────────────────────────────────────────────────────────────────────
--  Por que relink_activity limpa a origem ANTES de preencher o destino
--
--  `workouts_external_uniq` é um índice único parcial comum, não DEFERRABLE:
--
--    create unique index workouts_external_uniq
--      on workouts (tenant_id, external_id) where external_id is not null;
--
--  Postgres valida um índice desses a cada statement, não no commit. Copiar o
--  external_id para o destino enquanto a origem ainda o segura coloca duas
--  linhas sob o índice no mesmo instante — e ele rejeita ali, por mais que a
--  origem fosse ser limpa na linha seguinte. Foi exatamente esse o erro em
--  produção: `duplicate key value violates unique constraint`.
--
--  Este script prova as duas ordens numa tabela TEMP com a mesma forma do
--  índice. Não lê nem escreve nenhuma tabela real — pode rodar em qualquer
--  ambiente. Rode-o de novo se alguém for tentado a "simplificar" runRelink
--  num único UPDATE.
-- ───────────────────────────────────────────────────────────────────────────
drop table if exists t_probe;
drop table if exists t_result;

create temp table t_probe (id int primary key, tenant_id text not null, external_id text);
create unique index t_probe_uniq on t_probe (tenant_id, external_id) where external_id is not null;
insert into t_probe values (1, 'x', 'strava:123'), (2, 'x', null);

create temp table t_result (passo text, resultado text, estado_final text);

-- ORDEM ERRADA: copiar para o destino com a origem ainda segurando o mesmo id.
do $$
begin
  begin
    update t_probe dst set external_id = src.external_id
      from t_probe src where dst.id = 2 and src.id = 1;
    update t_probe set external_id = null where id = 1;
    insert into t_result values ('1. copiar-depois-limpar', 'PASSOU',
      (select string_agg(id || '=' || coalesce(external_id,'null'), ' ' order by id) from t_probe));
  exception when unique_violation then
    insert into t_result values ('1. copiar-depois-limpar', 'ERRO: ' || SQLERRM,
      (select string_agg(id || '=' || coalesce(external_id,'null'), ' ' order by id) from t_probe));
  end;
end $$;

-- ORDEM CORRETA: limpar a origem, depois preencher o destino.
do $$
begin
  begin
    update t_probe set external_id = null where id = 1;
    update t_probe set external_id = 'strava:123' where id = 2;
    insert into t_result values ('2. limpar-depois-setar', 'PASSOU',
      (select string_agg(id || '=' || coalesce(external_id,'null'), ' ' order by id) from t_probe));
  exception when unique_violation then
    insert into t_result values ('2. limpar-depois-setar', 'ERRO: ' || SQLERRM,
      (select string_agg(id || '=' || coalesce(external_id,'null'), ' ' order by id) from t_probe));
  end;
end $$;

-- Esperado:
--   1. copiar-depois-limpar | ERRO: duplicate key ... | 1=strava:123 2=null
--   2. limpar-depois-setar  | PASSOU                  | 1=null 2=strava:123
select * from t_result order by passo;

drop table t_probe;
drop table t_result;
