-- ────────────────────────────────────────────────────────────────────────────
--  add-device-pushes.sql — o que já foi enviado ao relógio do atleta.
--
--  Enviar um treino para a COROS cria uma cópia na agenda dela que a API NÃO
--  apaga nem move. Então o envio precisa lembrar, por sessão do TRAKR:
--    • o id que a COROS deu (idInPlan) — para ATUALIZAR na próxima vez, em vez
--      de criar um segundo treino no mesmo dia;
--    • a data em que foi posto — se a sessão mudou de dia no TRAKR, o antigo
--      continua lá e o atleta precisa saber;
--    • a impressão digital do que foi enviado — "mudou desde o envio?".
--
--  Por SESSÃO (workout_id), não por data: duas sessões no mesmo dia são dois
--  treinos lá também. Sobrevive a desconectar/reconectar de propósito: o treino
--  continua na agenda da COROS e reenviar não pode duplicá-lo.
--
--  ON DELETE CASCADE no atleta (RGPD) e na sessão. Sem RLS, como device_links:
--  o código sempre filtra por tenant_id.
--
--  Rodar uma vez no SQL Editor do projeto de PRODUTO. Re-executável.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists app.device_pushes (
  tenant_id    uuid not null references app.tenants(id) on delete cascade,
  provider     text not null,
  workout_id   uuid not null references public.workouts(id) on delete cascade,
  remote_id    text,                       -- idInPlan; null se a COROS não devolveu
  remote_date  text not null,              -- yyyyMMdd em que o treino foi posto
  payload_hash text not null,
  pushed_at    timestamptz not null default now(),
  primary key (tenant_id, provider, workout_id)
);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant select, insert, update, delete on app.device_pushes to app_writer';
  end if;
end $$;

-- Conferência.
select
  (select count(*) from information_schema.tables
    where table_schema = 'app' and table_name = 'device_pushes') as tabela,
  (select string_agg(privilege_type, ', ' order by privilege_type)
     from information_schema.role_table_grants
    where table_schema = 'app' and table_name = 'device_pushes' and grantee = 'app_writer') as permissoes;
