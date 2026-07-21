# TRAK coach MCP — tool contract (Phase 0)

The coach chat (Claude Desktop, ChatGPT connectors, or any MCP-capable client)
connects to **our hosted MCP server** with the athlete's per-account API key.
Building the write path as a standard remote MCP server is what makes it
portable across LLMs — the dashboard doesn't care which model wrote the data.

## Why the coach never touches Supabase directly

Handing a Supabase key to every customer's desktop would expose all tenants.
Instead the flow is:

```
coach chat → (MCP call + account API key) → OUR MCP server
   → sha256(key) → tenants.api_key_hash → tenant_id
   → set_config('app.tenant_id', tenant_id)   (RLS now scopes everything)
   → write, scoped to that tenant only
dashboard ← reads the same tenant's rows (also scoped by app.tenant_id)
```

**No tool takes a `tenant_id`** — the server injects it from the authenticated
key. A coach can only ever read/write its own athlete. Keys are revocable
(delete/rotate `api_key_hash`) and auditable (log every tool call per tenant).

## Auth
- Connection carries the account key (MCP auth field / `Authorization: Bearer …`).
- Server: `sha256(key)` → `tenants.api_key_hash`. Reject if no match or `status = 'canceled'`.

## Tools

### Read

The server started out write-only — the dashboard does the reading, so why
would the coach need it? Because the coach chat has no memory between sessions.
A new conversation knew nothing about the athlete and would either interview
them again or overwrite settings it couldn't see.

- **`get_profile`** — no arguments. Devices, metrics, mode, language, races,
  active cycle, zones, plus `configured: false` when the athlete is brand new.
  The coach should call this first in any new conversation.
- **`get_workouts`** — `{from, to}`. What's scheduled or done in a range, so
  writing a week builds on what exists instead of duplicating it.
- **`get_checkins`** — `{days}` (default 14). Readiness trend, because one day's
  number doesn't say whether the athlete is recovering or degrading.

### Write

### `set_profile` — discovery / config
Records what the athlete has so the dashboard adapts (this is the onboarding
"list every device and what it measures" step).
| param | type | notes |
|---|---|---|
| athlete | string | display name |
| devices | string[] | e.g. `["Garmin Fēnix 7", "Stryd"]` |
| metrics | string[] | capability flags → `hrv, body_battery, sleep, readiness, power, zones, bioimpedance, nutrition, strength, hydration, protein` |
| mode | `"race" \| "cycle"` | |
| locale? / units? | | `pt\|en\|es\|it` / `metric\|imperial` |

→ upsert `profiles`.

### `set_races` — target races (mode = race)
Replace the athlete's race list (A/B/C priorities, each with its own deadline).
| param | type |
|---|---|
| races | `[{ name, date: "YYYY-MM-DD", priority: "A"\|"B"\|"C" }]` |

→ replace `races` for the tenant.

### `set_cycle` — training cycle (mode = cycle)
For athletes with no race, just training toward a goal.
| param | type |
|---|---|
| name | string (e.g. "Ciclo de base — 16 semanas") |
| start_date | "YYYY-MM-DD" |
| weeks | int |
| phases | `[{ name, weeks: int, focus }]` |

→ upsert the active `training_cycles` row.

### `log_checkin` — daily readiness/wellness
Only the fields the athlete's devices actually provide; the rest stay null and
the hero hides them.
`date, hrv?, sleep_hours?, readiness_score?, body_battery?, resting_hr?,
recommendation?: "green"|"yellow"|"red", hydration_liters?, protein_grams?, notes?`
→ upsert `checkins` by `(tenant_id, date)`.

### `upsert_workout` — create or update ONE session
Update the existing **planned** row when logging a result — never insert a
second row (the duplicate-card rule we already hardened).
`date, discipline, title, status: "planned"|"done"|"skipped"|"modified",
planned_* / actual_* (duration_min, distance_km, tss, pace, power),
garmin_instructions?, zwo_content?, notes?, nutrition_notes?, match_id?`
→ upsert by `match_id` if given, else by `(tenant_id, date, discipline, title)`.

### `log_body_composition` — bioimpedance (metric: bioimpedance)
`date, weight_kg?, body_fat_pct?, muscle_mass_kg?, lean_mass_kg?, visceral_fat?, metabolic_age?`
→ upsert `body_composition` by `(tenant_id, date)`.

### `set_indicators` — performance zones (metric: zones)
`ftp_watts?, hr_zones?, bike_zones?, run_pace_zones?, swim_pace_zones?, thresholds…`
→ upsert `performance_indicators` (one row per tenant).

*(Later, thin additions: `log_injury`, `set_meal_plan`, `log_training_load`.)*

## Installation kit (per client)
Generated automatically on signup, personalized with the account key:
1. **Connection** — MCP config snippet ("paste into Claude Desktop" / "add
   connector in ChatGPT"), same endpoint + the account key.
2. **Behavior** — the evolved `INSTRUCOES_TREINADOR.md` (how to write check-ins,
   the upsert-not-duplicate rule, field mappings).
3. **Discovery questionnaire** — prompts the athlete to list devices + metrics so
   the coach can run `set_profile` on day one.
4. **How to ask the AI for training** — a few example prompts.
