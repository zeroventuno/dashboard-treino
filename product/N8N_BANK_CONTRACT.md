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
  "perPhase": 3,
  "phases":   ["Base","Build","Peak","Taper"]
}
```

`perPhase` = quantos workouts por esporte **por fase**. `phases` = quais fases do
ciclo gerar (o form deixa escolher; se vier vazio, o fluxo assume as quatro).

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

## 6. Fluxo pronto para importar — `n8n-workout-bank.json`

O arquivo `product/n8n-workout-bank.json` é o workflow completo. Arquitetura:

```
Webhook → Guard (confere o secret) → Read methodology (Postgres) →
  Leader agent (OpenAI): metodologia → diretriz por esporte →
  Plan per-sport tasks → Sport specialist (OpenAI, roda 1x por esporte):
    gera perPhase workouts por fase → Flatten → Insert draft (Postgres)
```

> Provedor de IA: **OpenAI** (Chat Completions). Modelo padrão `gpt-4o`.

O **agente líder** lê a metodologia da assessoria e escreve a diretriz de cada
esporte; cada **sub-agente especialista** (swim/bike/run/strength) gera os
workouts daquele esporte para as fases pedidas. Tudo entra como `draft`.

**Passos para ligar:**
1. **n8n → Import from File** → `product/n8n-workout-bank.json`.
2. **Credencial Postgres** (crie uma "Postgres" apontando pro *transaction
   pooler* do projeto de produto, papel com `select app.staff` + `insert
   app.workout_bank`) e selecione nos dois nós Postgres ("Read methodology" e
   "Insert draft").
3. **Chave da IA (OpenAI):** no n8n, setar a variável de ambiente
   `OPENAI_API_KEY` (os nós HTTP a leem em `{{ $env.OPENAI_API_KEY }}`). Modelo
   padrão `gpt-4o` — troque a string `model` nos nós Code "Build leader request"
   / "Plan per-sport tasks" por qualquer modelo que sua chave acesse (gpt-4.1,
   gpt-4o-mini, …). Modelos o-series/gpt-5 usam `max_completion_tokens` no lugar
   de `max_tokens` — se trocar pra um deles, ajuste esse campo nos mesmos nós.
4. (Opcional) setar `N8N_BANK_SECRET` no n8n **e** na Vercel (mesmo valor).
5. **Activate** o workflow. Copie a **Production URL** do nó Webhook
   (`.../webhook/trakr-bank`) e cole em `N8N_BANK_WEBHOOK_URL` na Vercel do
   dashboard.
6. Em `/coach/bank`, escolha esportes + fases + quantidade e clique **Gerar** →
   recarregue em ~1 min e valide os rascunhos.

**Trocar de volta para a Claude** (se carregar crédito lá): nos 2 nós HTTP, troque
a URL para `https://api.anthropic.com/v1/messages`, o header `Authorization` por
`x-api-key: {{ $env.ANTHROPIC_API_KEY }}` + `anthropic-version: 2023-06-01`; nos
nós Code, o `messages` vira `system` separado + `messages:[{role:'user',…}]` e o
parse lê `content[0].text` no lugar de `choices[0].message.content`.

> Nota: as versões dos nós (`typeVersion`) seguem um n8n recente. Se o seu n8n
> for mais antigo e um nó importar "amarelo", é só reabrir/reselecionar a opção —
> a lógica (prompts, SQL, conexões) já vem toda montada.
