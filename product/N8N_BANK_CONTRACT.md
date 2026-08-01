# n8n — Geração do banco de workouts (contrato)

Como o botão **"Gerar workouts"** de `/coach/bank` conversa com o n8n. A ferramenta
só **dispara**; o n8n gera (IAs especializadas por modalidade) e **escreve os
rascunhos** direto no banco. O treinador depois valida em `/coach/bank`.

## 1. Gatilho (o que a ferramenta manda)

`POST` do endpoint `/api/coach/bank/generate` para a URL do webhook do n8n
(variável `N8N_BANK_WEBHOOK_URL`, setada na Vercel do dashboard).

```
POST <N8N_BANK_WEBHOOK_URL>
Content-Type: application/json
x-trakr-secret: <N8N_BANK_SECRET>     # se configurado, o n8n deve conferir

{
  "agencyId": "uuid-da-assessoria",
  "staffId":  "uuid-do-treinador",
  "sports":   ["swim","bike","run","strength"],
  "perPhase": 3
}
```

## 2. O que o n8n faz

1. **Confere** o header `x-trakr-secret` (se você setou `N8N_BANK_SECRET`).
2. **Lê a metodologia** do treinador (node Postgres, conectado ao projeto do
   produto): `select methodology from app.staff where id = {{staffId}}`.
3. **Fan-out por modalidade:** um agente/IA **especializado por esporte** dos que
   vieram em `sports`. Cada um gera `perPhase` workouts para cada fase
   (Base, Build, Peak, Taper), no estilo da metodologia.
4. **Grava cada workout como rascunho** em `app.workout_bank`:

```sql
insert into app.workout_bank
  (agency_id, created_by, sport, phase, title, structure, duration_min, tss,
   description, source, status)
values
  ({{agencyId}}, {{staffId}}, {{sport}}, {{phase}}, {{title}},
   {{structure}}::jsonb, {{duration_min}}, {{tss}}, {{description}},
   'ai', 'draft');
```

`structure` é o mesmo formato do `upsert_workout`:
`[{ "label": "Aquecimento", "duration_min": 10, "intensity": 60, "target": "Z1", "note": "..." }, ...]`
(intensity = % do limiar; só escala o gráfico).

## 3. O que a ferramenta NÃO faz
- Não espera a geração terminar (o n8n é assíncrono). A página mostra
  *"gerando…"*; o treinador **recarrega** e vê os rascunhos.
- Não valida nada: tudo entra como `draft`. Só o treinador promove para
  `validated` (em `/coach/bank` ou pela ferramenta `set_bank_status`). E **só
  `validated` é usado na prescrição** — essa é a auditoria/assinatura dele.

## 4. Acesso ao banco pelo n8n
O node Postgres do n8n precisa conectar ao **projeto do produto** com um papel que
tenha `select on app.staff` e `insert on app.workout_bank`. O `app_writer` já
serve (é o mesmo que o servidor MCP usa). Use o **transaction pooler** do Supabase.

## 5. Variáveis
- `N8N_BANK_WEBHOOK_URL` — na Vercel do **dashboard** (produção): a URL do webhook.
- `N8N_BANK_SECRET` — na Vercel do dashboard **e** no n8n (mesmo valor), opcional
  mas recomendado.

Enquanto `N8N_BANK_WEBHOOK_URL` não estiver setada, o botão responde
"geração automática ainda não configurada" — o resto do banco (criar pela IA
copiloto, validar, reusar na prescrição) funciona normalmente.
