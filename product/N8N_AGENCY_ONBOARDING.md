# Onboarding de assessoria — contrato do n8n

O app faz o que precisa de estado e transação; o n8n faz o que é automação.
A divisão não é estética: o token do convite precisa ser de **uso único**, e uso
único é um `UPDATE` condicional dentro de uma transação. Isso não pode viver num
fluxo que pode ser reexecutado.

```
Stripe (depois)  →  n8n  →  POST /api/provision/agency  →  {url}  →  n8n envia e-mail
                                                                          ↓
                                                     dono clica → /coach/setup/{token}
                                                                          ↓
                                                       confirma → chave trakc_ (uma vez)
```

## 1. Variáveis de ambiente na Vercel

| env | para quê |
|---|---|
| `PROVISION_SECRET` | segredo do header que abre a rota de provisionamento |
| `APP_ORIGIN` | domínio canônico — o link do e-mail é montado com ele |

Sem `PROVISION_SECRET` a rota fica **fechada**, nunca aberta: um deploy que
esqueceu a env não pode virar um endpoint público de criar assessorias.

## 2. Nó HTTP Request no n8n

```
POST  {{APP_ORIGIN}}/api/provision/agency
Header:  x-provision-secret: {{$env.PROVISION_SECRET}}
Body (JSON):
{
  "agencyName": "Assessoria Exemplo",
  "ownerName":  "Nome do Dono",
  "ownerEmail": "dono@exemplo.com",
  "currency":   "BRL",
  "days": 14
}
```

Resposta:

```json
{ "ok": true, "url": "https://.../coach/setup/AbC...", "expiresAt": "2026-08-25", "agencyName": "Assessoria Exemplo" }
```

`url` contém o token **em texto, só nesta resposta** — o banco guarda apenas o
sha256. Se o fluxo perder essa resposta, o convite é irrecuperável e precisa de
um novo. Não logue o corpo dessa chamada no n8n.

## 3. Nó de e-mail

Assunto e corpo são seus; o que importa é o link (`{{ $json.url }}`) e dizer que
ele **vale uma vez e expira em `{{ $json.expiresAt }}`**.

Não escreva na mensagem que o link "dá acesso à conta" — ele dá acesso à
**criação** da conta. Depois de usado, quem entra é a chave `trakc_`, que o dono
copia na tela e guarda no gerenciador de senhas.

## 4. O que o n8n NÃO faz

- **Não gera o token.** A rota gera, porque só ela grava o hash na mesma operação.
- **Não gera a chave `trakc_`.** Ela nasce no momento em que é mostrada, dentro
  da transação que cria a assessoria — nunca fica esperando dentro de um e-mail.
- **Não reenvia convite.** Reenviar é criar um convite novo (chamar a rota de
  novo); o antigo continua válido até expirar, se você não quiser isso, o
  caminho é encurtar `days`.

## 5. Teste antes de ligar no Stripe

Chame a rota à mão com o header, abra a `url` numa aba anônima, confirme, e
verifique que **abrir a mesma url de novo mostra "link inválido ou já usado"**.
Esse segundo passo é o que prova o uso único — e é exatamente o caso que o
antivírus do provedor de e-mail exercita sozinho ao abrir links para checá-los.
Por isso o `GET` da tela só LÊ o convite e apenas o clique no botão o gasta.
