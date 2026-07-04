# Costa Navarino 70.3 — Painel de treino

Dashboard pessoal de treino para a preparação ao **IRONMAN 70.3 Costa Navarino** (25/10/2026).
Next.js 16 (App Router) · TypeScript · Tailwind v4 · Recharts · Supabase.

O **Supabase é a fonte única de verdade**, compartilhada entre este dashboard e o
chat com o Claude (via MCP), que grava check-ins diários direto nas tabelas.

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # preencha os valores
npm run dev                  # http://localhost:3000
```

Sem `SUPABASE_SERVICE_ROLE_KEY` o app roda com **dados de exemplo** (mock) — útil para
desenvolvimento. Com a chave, lê/escreve os dados reais.

## Variáveis de ambiente

| Variável | Descrição |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | **Segredo.** Service-role key (Settings > API). O RLS está travado, então o app usa essa chave no servidor. Nunca exponha no cliente. |
| `DASHBOARD_PASSWORD` | Senha única que protege o site (via `proxy.ts`). |

## Banco de dados

- Schema: [`supabase/migrations/`](supabase/migrations) (9 tabelas).
- Seed de exemplo: [`supabase/seed.sql`](supabase/seed.sql).
- RLS habilitado em todas as tabelas **sem policies** → apenas a service-role key
  (servidor) e o MCP acessam. Nada é público.

### Tabelas
`training_load` · `workouts` · `phases` · `performance_milestones` ·
`performance_indicators` · `strength_sessions` · `checkins` · `injury_log`

## Como o Claude grava check-ins

No chat com acesso MCP ao projeto `ironman-costa-navarino`, basta um insert/upsert:

```sql
insert into checkins (date, hrv, sleep_hours, readiness_score, body_battery, resting_hr, recommendation, notes)
values (current_date, 78, 7.9, 82, 74, 48, 'green', 'Pronto pro treino de hoje')
on conflict (date) do update set
  hrv = excluded.hrv, sleep_hours = excluded.sleep_hours,
  readiness_score = excluded.readiness_score, body_battery = excluded.body_battery,
  resting_hr = excluded.resting_hr, recommendation = excluded.recommendation, notes = excluded.notes;
```

O dashboard revalida a cada 60s (ISR), então o novo check-in aparece sozinho.

## Deploy

Deploy na Vercel. Configure as 3 variáveis de ambiente acima no projeto da Vercel
(Production + Preview). O `SUPABASE_SERVICE_ROLE_KEY` deve ser adicionado como
**segredo** — nunca commitado.
