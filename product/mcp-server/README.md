# MY TRAKR coach MCP server

The write path from any LLM chat (Claude Desktop, ChatGPT, …) into a tenant's
training data. A standard **remote MCP server** — the dashboard doesn't care
which model wrote the data, so multi-LLM support is free.

## How it works
1. The coach chat connects with the athlete's **account API key** (Bearer).
2. The server hashes the key → looks up `tenants.api_key_hash` → `tenant_id`.
3. Every tool runs inside `withTenant(tenantId, …)`, which sets
   `app.tenant_id` so **RLS scopes all writes to that tenant**. No tool takes a
   `tenant_id`, so a coach can only ever write to its own athlete.

Tools: `set_profile`, `set_races`, `set_cycle`, `log_checkin`, `upsert_workout`,
`log_body_composition`, `set_indicators` (see `../mcp-contract.md`).

## Run locally
```bash
cp .env.example .env      # set DATABASE_URL to the product project (app_writer role)
npm install
npm run dev               # standalone server → http://localhost:8787/mcp
```

## Deploy on Vercel (serverless)
`api/mcp.ts` is the Vercel function; `src/index.ts` is only for local dev.
```bash
npx vercel            # from THIS folder → creates a new Vercel project, deploys
# then set the secret (app_writer via the TRANSACTION POOLER — see .env.example):
npx vercel env add DATABASE_URL      # paste the pooler connection string
npx vercel --prod                    # redeploy with the secret
```
Endpoint: `https://<project>.vercel.app/api/mcp`. Low-traffic (a few writes/day
/user), so the free tier is plenty.

## Connect a coach chat (Claude Desktop)
Add to `claude_desktop_config.json` (uses the `mcp-remote` bridge so the account
key travels as a Bearer header):
```json
{
  "mcpServers": {
    "mytrakr-coach": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://<project>.vercel.app/api/mcp",
        "--header", "Authorization: Bearer <YOUR_ACCOUNT_KEY>"
      ]
    }
  }
}
```
ChatGPT: add a custom connector with the same URL and an `Authorization: Bearer`
header. The account key is what `migrate.mjs` printed.

## Migrate an existing athlete (one-shot)
Seeds the product DB with a backup produced from the personal project, creates
the tenant, and prints the account API key once:
```bash
DATABASE_URL=postgres://...  TENANT_EMAIL=you@example.com \
  node migrate.mjs ../backup/personal-data-2026-07-11.json
```

## Running these scripts on Windows
PowerShell has no inline `VAR=value cmd` prefix — set each variable on its own
line first, and use **single** quotes so a `$` in the password isn't
interpolated away:
```powershell
$env:DATABASE_URL = 'postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:6543/postgres'
$env:TENANT_EMAIL = 'you@example.com'
node migrate.mjs ../backup/personal-data-2026-07-11.json
```
URL-encode the password in either shell: `@` → `%40`, `!` → `%21`. Use the
**pooler** host, not `db.<ref>.supabase.co` (that one is IPv6-only).

## Which role to connect as
- `app_writer` for anything the **running app** does — reads and training-data
  writes. It's a non-superuser, so RLS actually enforces isolation (`postgres`
  and the service role bypass RLS entirely).
- `postgres` only for **admin** acts: `provision.mjs` creates accounts, and
  `app_writer` deliberately can't (`grant select on app.tenants` and nothing
  more). Running provision as `app_writer` fails with
  `permission denied for table tenants` — that's the grant working as designed,
  not a bug to patch by widening it.

## Security notes
- Keys are stored only as sha256 hashes; rotate by replacing `api_key_hash`.
- Keys are stored only as sha256 hashes; rotate by replacing `api_key_hash`.
- Every tool call can be logged per tenant for audit.
