-- ────────────────────────────────────────────────────────────────────────────
--  add-attention-outcomes.sql — o que aconteceu depois do alerta.
--
--  A tela de atenção diz QUEM ligar. Nada registra o que veio depois: o coach
--  ligou? O aluno ficou? Saiu — e por quê? Sem isso o alerta é um palpite que
--  nunca é corrigido, e nenhum modelo futuro (nem regra melhor) tem rótulo para
--  aprender: quem sai, quando, depois de qual queda.
--
--  UM EVENTO POR LINHA, só se acrescenta. O estado atual de um aluno é o evento
--  mais recente; o histórico ("contatado dia 3, ficou dia 9, saiu dia 40") é a
--  parte útil e não pode ser sobrescrito.
--
--  O SNAPSHOT É O PONTO. `state`, `weekly_before`, `weekly_now`, `days_silent` e
--  `monthly_value` são o que a tela MOSTRAVA no instante do registro, calculados
--  no servidor. Reconstruir isso depois é impossível — o sinal é uma janela de
--  14 dias que anda — e é exatamente o conjunto de features que um rótulo de
--  "saiu" precisa para valer alguma coisa.
--
--  PRIVACIDADE: `reason` é um código fechado de propósito (agregável, e sem
--  espaço para dado de saúde). `note` é texto livre, curto, e a tela avisa para
--  não pôr saúde ali. Tudo referencia app.tenants com ON DELETE CASCADE, como as
--  outras 19 tabelas: apagar a conta do atleta (RGPD) leva os eventos junto.
--
--  SEM RLS, como app.agency_invites e app.staff_athletes: a barreira é o código
--  (a escrita só insere se o atleta é da assessoria de quem registra, e, para um
--  não-dono, só se está na carteira dele — ver recordAttentionOutcome).
--
--  Rodar uma vez no SQL Editor do projeto de PRODUTO. Re-executável.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists app.attention_outcomes (
  id            uuid primary key default gen_random_uuid(),
  agency_id     uuid not null references app.agencies(id) on delete cascade,
  tenant_id     uuid not null references app.tenants(id)  on delete cascade,
  -- Quem registrou. SET NULL: um profissional desligado não apaga o histórico.
  staff_id      uuid references app.staff(id) on delete set null,

  outcome       text not null check (outcome in ('contacted', 'stayed', 'left')),
  -- Só faz sentido quando saiu — e quando saiu é obrigatório.
  reason        text check (reason in (
                  'price', 'time', 'health', 'results', 'motivation',
                  'other_coach', 'life_event', 'service', 'unknown', 'other'
                )),
  note          text check (char_length(note) <= 280),

  -- O que a tela mostrava (ver cabeçalho).
  state         text check (state in ('new', 'active', 'at_risk', 'inactive')),
  weekly_before numeric,
  weekly_now    numeric,
  days_silent   int,
  monthly_value numeric,

  created_at    timestamptz not null default now(),

  constraint attention_outcomes_reason_rule check (
    (outcome = 'left' and reason is not null) or (outcome <> 'left' and reason is null)
  )
);

-- "O último evento deste aluno" — a leitura que a tela faz a cada carregamento.
create index if not exists attention_outcomes_tenant
  on app.attention_outcomes (tenant_id, created_at desc);
create index if not exists attention_outcomes_agency
  on app.attention_outcomes (agency_id, created_at desc);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    -- Só acrescenta e lê: não há update nem delete pela aplicação. Um evento
    -- errado se corrige com outro evento mais recente.
    execute 'grant select, insert on app.attention_outcomes to app_writer';
  end if;
end $$;

-- Conferência: a tabela existe e app_writer tem SELECT e INSERT.
select
  (select count(*) from information_schema.tables
    where table_schema = 'app' and table_name = 'attention_outcomes') as tabela,
  (select string_agg(privilege_type, ', ' order by privilege_type)
     from information_schema.role_table_grants
    where table_schema = 'app' and table_name = 'attention_outcomes'
      and grantee = 'app_writer') as permissoes;
