-- ────────────────────────────────────────────────────────────────────────────
--  add-athlete-sports.sql — que modalidades cada atleta da assessoria treina.
--
--  Serve ao sugeridor de alocação: cruzar isto com `staff.sports` é o que
--  permite propor "este aluno combina com a Ana". O painel conecta como
--  app_writer sob RLS, que só enxerga UM tenant por vez, então a leitura tem
--  que ser SECURITY DEFINER — mesmo padrão de app.agency_attention, com o join
--  por agency_id como fronteira de autorização.
--
--  DUAS FONTES, e a ordem importa:
--
--   1. O que o atleta DECLAROU (profiles.preferences → availability.sports, o
--      bloco "Minha semana"). Vale para quem acabou de entrar — que é
--      exatamente o caso que o sugeridor precisa resolver.
--   2. O que ele de fato TREINOU (disciplinas distintas nos workouts). Vale
--      para quem já tem histórico e talvez nunca tenha preenchido nada.
--
--  A união das duas, porque nenhuma sozinha cobre os dois momentos da vida de
--  um aluno. Vazio é resposta legítima: um aluno recém-cadastrado sem nada
--  preenchido não tem modalidade conhecida, e o sugeridor trata isso como
--  "sem sinal de especialidade" em vez de inventar uma.
--
--  Rodar uma vez no SQL Editor do projeto de PRODUTO. Re-executável.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function app.agency_athlete_sports(p_agency uuid)
returns table (tenant_id uuid, sports text[])
language sql
security definer
set search_path = app, public
as $$
  select t.id,
         coalesce(
           array(
             select distinct s from (
               -- declarado: cada dia da semana pode listar esportes preferidos
               select jsonb_array_elements_text(d.value->'sports') as s
                 from public.profiles p,
                      lateral jsonb_each(
                        case when jsonb_typeof(p.preferences->'availability') = 'object'
                             then p.preferences->'availability' else '{}'::jsonb end
                      ) as d(key, value)
                where p.tenant_id = t.id
                  and jsonb_typeof(d.value->'sports') = 'array'
               union
               -- praticado: o que apareceu no calendário dele
               select w.discipline
                 from public.workouts w
                where w.tenant_id = t.id
                  and w.discipline in ('swim','bike','run','strength')
             ) u
             where s in ('swim','bike','run','strength')
             order by s
           ),
           '{}'::text[]
         ) as sports
    from app.tenants t
   where t.agency_id = p_agency;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_writer') then
    execute 'grant execute on function app.agency_athlete_sports(uuid) to app_writer';
  end if;
end $$;

-- Conferência.
select proname, prosecdef as security_definer
  from pg_proc where proname = 'agency_athlete_sports';
