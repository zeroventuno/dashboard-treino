// COROS MCP: PKCE, OAuth/MCP wire protocol against a fake server, schema-driven
// query building, and tolerant record reading.
// Rode com:  npx tsx product/tests/coros.ts
import {
  CorosError, CorosSession, authorizeUrl, buildRecordQuery, challengeOf, dayRange, disciplineOf,
  exchangeCode, findRecords, localDateOf, mapRecord, mapRecords, newPkce, parseRpcBody,
  refreshTokens, registerClient, toolPayload, type McpTool,
} from "../../lib/coros";

// CommonJS under tsx (the package declares no "type"), so no top-level await.
async function main() {
let fail = 0;
const ck = (l: string, c: boolean, e = "") => {
  if (!c) { fail++; console.log("FAIL  " + l + (e ? "  → " + e : "")); }
  else console.log("ok    " + l);
};
const throwsKind = async (fn: () => unknown | Promise<unknown>) => {
  try { await fn(); return null; } catch (e) { return e instanceof CorosError ? e.kind : "other"; }
};

// ── PKCE ────────────────────────────────────────────────────────────────────
// RFC 7636 appendix B — the one vector everybody checks.
ck(
  "PKCE: S256 bate com o vetor do RFC 7636",
  challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") === "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
);
{
  const a = newPkce(), b = newPkce();
  ck("PKCE: verifier tem 43–128 chars, só base64url", /^[A-Za-z0-9_-]{43,128}$/.test(a.verifier));
  ck("PKCE: challenge corresponde ao verifier", a.challenge === challengeOf(a.verifier));
  ck("PKCE: cada par é diferente", a.verifier !== b.verifier);
}

// ── parseRpcBody: JSON ou SSE ───────────────────────────────────────────────
ck("rpc: JSON puro", (parseRpcBody('{"result":{"a":1}}', "application/json").result as { a: number }).a === 1);
ck(
  "rpc: SSE usa o ÚLTIMO evento",
  (parseRpcBody('data: {"result":{"n":1}}\n\ndata: {"result":{"n":2}}\n\n', "text/event-stream").result as { n: number }).n === 2,
);
ck(
  "rpc: SSE com CRLF e sem linha em branco final",
  (parseRpcBody('event: message\r\ndata: {"result":{"n":7}}', "text/event-stream").result as { n: number }).n === 7,
);
ck(
  "rpc: SSE com data em várias linhas é remontado",
  (parseRpcBody('data: {"result":\ndata: {"n":3}}\n\n', "text/event-stream").result as { n: number }).n === 3,
);
ck("rpc: corpo vazio não quebra", Object.keys(parseRpcBody("  ", "application/json")).length === 0);

// ── toolPayload ─────────────────────────────────────────────────────────────
ck("payload: structuredContent tem prioridade", (toolPayload({ structuredContent: { x: 1 }, content: [{ type: "text", text: "{\"x\":2}" }] }) as { x: number }).x === 1);
ck("payload: JSON dentro do texto", (toolPayload({ content: [{ type: "text", text: "{\"x\":2}" }] }) as { x: number }).x === 2);
ck("payload: texto não-JSON vira string", toolPayload({ content: [{ type: "text", text: "sem dados" }] }) === "sem dados");

// ── buildRecordQuery: só o que o schema nomeia ──────────────────────────────
const tool = (properties: NonNullable<McpTool["inputSchema"]>["properties"], required: string[] = []): McpTool =>
  ({ name: "querySportRecords", inputSchema: { properties, required } });
const range = { from: "2026-09-01", to: "2026-10-11" };
{
  const q = buildRecordQuery(tool({ startDate: { type: "string" }, endDate: { type: "string" } }), range);
  ck("query: startDate/endDate em ISO", q.startDate === "2026-09-01" && q.endDate === "2026-10-11");
}
{
  const q = buildRecordQuery(
    tool({ startDay: { type: "integer", description: "Start day, format yyyyMMdd" }, endDay: { type: "integer", description: "End day, format yyyyMMdd" } }, ["startDay", "endDay"]),
    range,
  );
  ck("query: yyyyMMdd inteiro quando o schema pede", q.startDay === 20260901 && q.endDay === 20261011, JSON.stringify(q));
}
{
  const q = buildRecordQuery(tool({ beginTime: { type: "string", format: "date-time" }, endTime: { type: "string", format: "date-time" } }), range);
  ck("query: date-time com hora", q.beginTime === "2026-09-01T00:00:00Z" && q.endTime === "2026-10-11T23:59:59Z", JSON.stringify(q));
}
{
  const q = buildRecordQuery(tool({ from: { type: "string" }, to: { type: "string" }, limit: { type: "integer", maximum: 50 } }), range);
  ck("query: limit respeita o máximo do schema", q.limit === 50 && q.from === "2026-09-01" && q.to === "2026-10-11");
}
{
  const q = buildRecordQuery(tool({ total: { type: "integer" }, todayOnly: { type: "boolean" } }), range);
  ck("query: 'total'/'today' não são confundidos com 'to'", Object.keys(q).length === 0, JSON.stringify(q));
}
ck(
  "query: argumento obrigatório desconhecido vira erro NOMEADO",
  (await throwsKind(() => buildRecordQuery(tool({ startDate: { type: "string" }, userRegionCode: { type: "string" } }, ["userRegionCode"]), range))) === "schema",
);
{
  let msg = "";
  try { buildRecordQuery(tool({ zzz: { type: "string" } }, ["zzz"]), range); } catch (e) { msg = (e as Error).message; }
  ck("query: o erro cita o NOME do argumento, não valores", msg.includes("zzz") && msg.includes("querySportRecords"), msg);
}

// ── findRecords ─────────────────────────────────────────────────────────────
const rec = { id: 1, a: 1 };
ck("records: array no topo", findRecords([rec, rec]).length === 2);
ck("records: {records:[…]}", findRecords({ records: [rec] }).length === 1);
ck("records: {data:{list:[…]}} aninhado", findRecords({ code: 0, data: { total: 1, list: [rec] } }).length === 1);
ck("records: sem array → vazio", findRecords({ ok: true, message: "nada" }).length === 0);
ck("records: string (texto livre) → vazio", findRecords("sem dados").length === 0);

// ── mapRecord ───────────────────────────────────────────────────────────────
const EPOCH_2026_10_10_1030Z = Date.UTC(2026, 9, 10, 10, 30, 0) / 1000;
{
  const m = mapRecord({ labelId: "abc123", sportType: 100, startTime: EPOCH_2026_10_10_1030Z, workoutTime: 3000, distance: 10000, name: "Morning Run" });
  ck("map: corrida — id, data, duração, km, pace",
    "item" in m && m.item.external_id === "coros:abc123" && m.item.date === "2026-10-10" && m.item.discipline === "run" &&
    m.item.actual_duration_min === 50 && m.item.actual_distance_km === 10 && m.item.actual_pace === "5:00/km" &&
    m.item.title === "Morning Run", JSON.stringify(m));
}
{
  const m = mapRecord({ labelId: 7, sportType: 200, startTime: EPOCH_2026_10_10_1030Z, workoutTime: 3600, distance: 30000, avgPower: 187.4 });
  ck("map: bike — potência com W, sem pace", "item" in m && m.item.discipline === "bike" && m.item.actual_power_watts === "187W" && m.item.actual_pace === null);
}
{
  const m = mapRecord({ id: "s1", sportType: 300, startTime: EPOCH_2026_10_10_1030Z, totalTime: 2400, distance: 1500 });
  ck("map: natação — 1500 é METROS e vira 1.5 km, pace /100m", "item" in m && m.item.actual_distance_km === 1.5 && m.item.actual_pace === "2:40/100m", JSON.stringify(m));
}
{
  const m = mapRecord({ id: "r1", sportType: 100, startTime: EPOCH_2026_10_10_1030Z, workoutTime: 1800, distance: 6.2 });
  ck("map: corrida com distance=6.2 é lida como km", "item" in m && m.item.actual_distance_km === 6.2);
}
ck("map: esporte fora dos quatro é pulado, não importado", (() => { const m = mapRecord({ id: 1, sportType: 104, startTime: EPOCH_2026_10_10_1030Z, workoutTime: 3600 }); return "skip" in m && m.skip === "other_sport"; })());
ck("map: sem id → no_id", (() => { const m = mapRecord({ sportType: 100, startTime: 1, workoutTime: 60 }); return "skip" in m && m.skip === "no_id"; })());
ck("map: sem duração → no_duration", (() => { const m = mapRecord({ id: 1, sportType: 100, startTime: EPOCH_2026_10_10_1030Z }); return "skip" in m && m.skip === "no_duration"; })());
ck("map: sem data → no_date", (() => { const m = mapRecord({ id: 1, sportType: 100, workoutTime: 60 }); return "skip" in m && m.skip === "no_date"; })());
ck("map: duração em HH:MM:SS", (() => { const m = mapRecord({ id: 1, sportType: 100, startTime: EPOCH_2026_10_10_1030Z, duration: "01:02:03", distance: 12000 }); return "item" in m && m.item.actual_duration_min === 62.1; })());

// data local
ck("data: AAAAMMDD numérico", localDateOf({ happenDay: 20261010 }) === "2026-10-10");
ck("data: campo local vence o epoch", localDateOf({ startTimeLocal: "2026-10-09T22:15:00", startTime: EPOCH_2026_10_10_1030Z }) === "2026-10-09");
{
  // 23:30 UTC no dia 10 com fuso +8 (32 quarter-hours) já é dia 11 local.
  const late = Date.UTC(2026, 9, 10, 23, 30, 0) / 1000;
  ck("data: offset em quarter-hours muda o dia local", localDateOf({ startTime: late, startTimezone: 32 }) === "2026-10-11");
  ck("data: sem offset, lê como UTC", localDateOf({ startTime: late }) === "2026-10-10");
  ck("data: epoch em milissegundos", localDateOf({ startTime: late * 1000 }) === "2026-10-10");
}
ck("esporte: nome textual", disciplineOf({ sportName: "Open Water Swim" }) === "swim" && disciplineOf({ type: "Trail Run" }) === "run");

// lote
{
  const b = mapRecords([
    { id: 1, sportType: 100, startTime: EPOCH_2026_10_10_1030Z, workoutTime: 600 },
    { id: 2, sportType: 104, startTime: EPOCH_2026_10_10_1030Z, workoutTime: 600 },
    { sportType: 100, startTime: EPOCH_2026_10_10_1030Z, workoutTime: 600 },
  ]);
  ck("lote: 1 importado, 1 outro esporte, 1 sem id", b.items.length === 1 && b.skipped.other_sport === 1 && b.skipped.no_id === 1);
  ck("lote: sampleKeys são CHAVES, nunca valores", b.sampleKeys.join() === "id,sportType,startTime,workoutTime");
}
ck("dayRange: janela fechada em dias", (() => { const r = dayRange(45, new Date("2026-10-11T12:00:00Z")); return r.from === "2026-08-27" && r.to === "2026-10-11"; })());

// ── Protocolo contra um COROS falso ─────────────────────────────────────────
type Handler = (req: { url: URL; method: string; headers: Headers; text: string }) => Response;
const realFetch = globalThis.fetch;
const seen: { register?: Record<string, unknown>; token?: URLSearchParams; rpc: { method: string; auth: string | null }[] } = { rpc: [] };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

let metaOverride: Record<string, string> | null = null;
let toolMode: "ok" | "tool_error" | "rpc_error" = "ok";

const fake: Handler = ({ url, method, headers, text }) => {
  if (url.pathname === "/.well-known/oauth-authorization-server") {
    return json(metaOverride ?? {
      issuer: url.origin,
      authorization_endpoint: `${url.origin}/oauth2/authorize`,
      token_endpoint: `${url.origin}/oauth2/token`,
      registration_endpoint: `${url.origin}/connect/register`,
    });
  }
  if (url.pathname === "/connect/register") {
    seen.register = JSON.parse(text);
    return json({ client_id: "cid-123" }, 201);
  }
  if (url.pathname === "/oauth2/token") {
    const f = new URLSearchParams(text);
    seen.token = f;
    if (f.get("grant_type") === "refresh_token" && f.get("refresh_token") === "dead") return json({ error: "invalid_grant", error_description: "SECRET-DETAIL" }, 400);
    return json({ access_token: "AT-1", refresh_token: "RT-1", expires_in: 7200, scope: "openid mcp.tools" });
  }
  if (url.pathname === "/mcp" && method === "POST") {
    const auth = headers.get("authorization");
    const body = JSON.parse(text) as { id: number; method: string; params?: { name?: string } };
    seen.rpc.push({ method: body.method, auth });
    if (auth !== "Bearer AT-1") return new Response("", { status: 401 });
    if (body.method === "initialize") return json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } });
    if (body.method === "tools/list") {
      const tools = [{ name: "querySportRecords", inputSchema: { properties: { startDate: { type: "string" } }, required: [] } }];
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools } })}\n\n`, {
        status: 200, headers: { "Content-Type": "text/event-stream" },
      });
    }
    if (body.method === "tools/call") {
      if (toolMode === "rpc_error") return json({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "bad params" } });
      if (toolMode === "tool_error") return json({ jsonrpc: "2.0", id: body.id, result: { isError: true, content: [{ type: "text", text: "date range too long" }] } });
      return json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify({ data: { list: [{ id: 9 }] } }) }] } });
    }
  }
  return new Response("not found", { status: 404 });
};

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const text = init?.body ? String(init.body) : "";
  return fake({ url, method: (init?.method ?? "GET").toUpperCase(), headers: new Headers(init?.headers), text });
}) as typeof fetch;

try {
  // First, and on the region nothing else has touched yet: discovery results
  // are cached, and a rejected one must not be (nor a good one stand in for it).
  // Endpoints off the issuer's origin are not trusted — the PKCE verifier and
  // the refresh token travel to them.
  metaOverride = {
    authorization_endpoint: "https://evil.example/authorize",
    token_endpoint: "https://evil.example/token",
    registration_endpoint: "https://evil.example/register",
  };
  ck("segurança: endpoints fora do issuer são recusados", (await throwsKind(() => registerClient("us", "https://x/cb"))) === "protocol");
  metaOverride = null;

  const cid = await registerClient("eu", "https://mytrakr.fit/api/app/coros/callback");
  ck("registro: devolve o client_id", cid === "cid-123");
  const reg = seen.register ?? {};
  ck("registro: cliente PÚBLICO (sem segredo) com PKCE", reg.token_endpoint_auth_method === "none");
  ck("registro: redirect_uri e grants pedidos", JSON.stringify(reg.redirect_uris) === '["https://mytrakr.fit/api/app/coros/callback"]' &&
    JSON.stringify(reg.grant_types) === '["authorization_code","refresh_token"]');

  const { challenge } = newPkce();
  const au = new URL(await authorizeUrl("eu", { clientId: "cid-123", redirectUri: "https://mytrakr.fit/cb", state: "st", challenge }));
  ck("authorize: endpoint do issuer EU", au.origin === "https://mcpeu.coros.com" && au.pathname === "/oauth2/authorize");
  ck("authorize: S256 + resource + scopes", au.searchParams.get("code_challenge_method") === "S256" &&
    au.searchParams.get("resource") === "https://mcpeu.coros.com/mcp" && au.searchParams.get("scope") === "openid offline_access mcp.tools");
  const au2 = new URL(await authorizeUrl("us", { clientId: "c", redirectUri: "https://x/cb", state: "s", challenge }));
  ck("authorize: região US vai para o cluster US", au2.origin === "https://mcpus.coros.com");

  const before = Math.floor(Date.now() / 1000);
  const tok = await exchangeCode("eu", { clientId: "cid-123", code: "CODE", redirectUri: "https://mytrakr.fit/cb", verifier: "VER" });
  ck("token: devolve access/refresh", tok.access_token === "AT-1" && tok.refresh_token === "RT-1");
  ck("token: expires_at em segundos Unix a partir de expires_in", tok.expires_at >= before + 7200 && tok.expires_at <= before + 7205);
  ck("token: envia code_verifier e client_id", seen.token?.get("code_verifier") === "VER" && seen.token?.get("client_id") === "cid-123" && seen.token?.get("grant_type") === "authorization_code");

  const rt = await refreshTokens("eu", { clientId: "cid-123", refreshToken: "RT-0" });
  ck("refresh: grant refresh_token com client_id", rt.access_token === "AT-1" && seen.token?.get("grant_type") === "refresh_token" && seen.token?.get("client_id") === "cid-123");
  {
    let msg = "";
    try { await refreshTokens("eu", { clientId: "cid-123", refreshToken: "dead" }); } catch (e) { msg = (e as Error).message; }
    ck("refresh: invalid_grant aparece, o corpo do erro NÃO", msg.includes("invalid_grant") && !msg.includes("SECRET-DETAIL"), msg);
  }

  const s = new CorosSession("eu", "AT-1");
  await s.init();
  const tools = await s.listTools();
  ck("mcp: initialize + tools/list (resposta SSE)", tools.length === 1 && tools[0].name === "querySportRecords");
  const out = await s.callTool("querySportRecords", {});
  ck("mcp: tools/call devolve o payload parseado", findRecords(out).length === 1);
  ck("mcp: header Authorization Bearer em toda chamada", seen.rpc.length >= 3 && seen.rpc.every((r) => r.auth === "Bearer AT-1"));

  const bad = new CorosSession("eu", "EXPIRED");
  ck("mcp: 401 vira kind=unauthorized (para o refresh)", (await throwsKind(() => bad.init())) === "unauthorized");

  toolMode = "tool_error";
  {
    let msg = ""; let kind = "";
    try { await s.callTool("querySportRecords", {}); } catch (e) { msg = (e as Error).message; kind = (e as CorosError).kind; }
    ck("mcp: isError dentro de 200 NÃO vira 'sem registros'", kind === "tool" && msg.includes("date range too long"), `${kind} ${msg}`);
  }
  toolMode = "rpc_error";
  ck("mcp: erro JSON-RPC vira kind=rpc", (await throwsKind(() => s.callTool("querySportRecords", {}))) === "rpc");
  toolMode = "ok";
} finally {
  globalThis.fetch = realFetch;
}

console.log(fail ? `\n${fail} falha(s)` : "\ntudo certo");
process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
