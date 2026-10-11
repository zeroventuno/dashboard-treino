// COROS MCP: PKCE, OAuth/MCP wire protocol against a fake server, schema-driven
// query building, and tolerant record reading.
// Rode com:  npx tsx product/tests/coros.ts
import {
  CorosError, CorosSession, authorizeUrl, buildRecordQuery, challengeOf, dayRange, describePayload, disciplineOf,
  exchangeCode, findRecords, localDateOf, mapRecord, mapRecords, newPkce, pageSizeOf, parseImportRange,
  parseRpcBody, refreshTokens, registerClient, toolPayload, type McpTool,
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
{
  // A sentence wrapped around a JSON document is still the document.
  const wrapped = toolPayload({ content: [{ type: "text", text: 'Found 2 records:\n[{"labelId":"a","sportType":100},{"labelId":"b","sportType":301}]\nDone.' }] });
  ck("payload: JSON embutido em frase é lido", Array.isArray(wrapped) && wrapped.length === 2, JSON.stringify(wrapped));
  const obj = toolPayload({ content: [{ type: "text", text: 'Result: {"data":{"list":[{"id":1}]}}' }] }) as { data?: { list?: unknown[] } };
  ck("payload: objeto embutido em frase é lido", obj?.data?.list?.length === 1, JSON.stringify(obj));
  ck("payload: colchetes que não são JSON não viram dado", toolPayload({ content: [{ type: "text", text: "see [1] and {x" }] }) === "see [1] and {x");
  // Valid JSON that is not a result must not read as "a structured reply".
  ck("payload: '[1]' / '[]' dentro de prosa continua sendo prosa",
    toolPayload({ content: [{ type: "text", text: "see [1] and [2]" }] }) === "see [1] and [2]" &&
      toolPayload({ content: [{ type: "text", text: "Found 0 records: []" }] }) === "Found 0 records: []");
}

// ── describePayload: "vazio" só vale para resposta ESTRUTURADA ──────────────
{
  const prose = describePayload("No workout records found between 20240615 and 20240625.");
  ck("describe: prosa NÃO é 'entendida' (e traz o começo do texto)", !prose.understood && prose.note?.startsWith("No workout records") === true, JSON.stringify(prose));
  ck("describe: prosa longa é cortada", (describePayload("x ".repeat(400)).note ?? "").length <= 240);
  const empty = describePayload({ records: [], total: 0 });
  ck("describe: objeto vazio é entendido; só os NOMES dos campos", empty.understood && empty.note === "{ records, total }", JSON.stringify(empty));
  ck("describe: array vazio é entendido", describePayload([]).understood === true);
  ck("describe: null/undefined não é entendido", describePayload(null).understood === false && describePayload(undefined).understood === false);
  ck("describe: texto vazio → sem nota", describePayload("   ").note === null);
}

// ── buildRecordQuery: só o que o schema nomeia ──────────────────────────────
const tool = (properties: NonNullable<McpTool["inputSchema"]>["properties"], required: string[] = []): McpTool =>
  ({ name: "querySportRecords", inputSchema: { properties, required } });
const range = { from: "2026-09-01", to: "2026-10-11" };
{
  const q = buildRecordQuery(tool({ startDate: { type: "string" }, endDate: { type: "string" } }), range);
  // No format hint → yyyyMMdd, the form the official connector sent.
  ck("query: string sem dica de formato vira yyyyMMdd", q.startDate === "20260901" && q.endDate === "20261011", JSON.stringify(q));
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
  ck("query: limit respeita o máximo do schema", q.limit === 50 && q.from === "20260901" && q.to === "20261011", JSON.stringify(q));
  const small = buildRecordQuery(tool({ from: { type: "string" }, to: { type: "string" }, limit: { type: "integer", maximum: 20 } }), range);
  const big = buildRecordQuery(tool({ from: { type: "string" }, to: { type: "string" }, limit: { type: "integer", maximum: 500 } }), range);
  ck("query: maximum menor vale; maior que 50 é limitado a 50", small.limit === 20 && big.limit === 50, JSON.stringify([small.limit, big.limit]));
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
{
  // The shape COROS actually served: filters listed as required.
  const q = buildRecordQuery(
    tool({
      startDate: { type: "string" },
      endDate: { type: "string" },
      sportTypeCodes: { type: ["array", "null"] },
      minDistanceKm: { type: ["number", "null"] },
      minDurationMinutes: { anyOf: [{ type: "number" }, { type: "null" }] },
      maxAveragePace: { anyOf: [{ type: "number" }, { type: "null" }] },
      locationKeyword: { type: ["string", "null"] },
    }, ["startDate", "endDate", "sportTypeCodes", "minDistanceKm", "minDurationMinutes", "maxAveragePace", "locationKeyword"]),
    range,
  );
  ck(
    "query: filtros anuláveis vão como null (não 0/\"\"/[]); sportTypeCodes vai como todos os esportes",
    // sportTypeCodes is the one that is never null: it gets "every sport".
    JSON.stringify(q.sportTypeCodes) === "[65535]" && q.minDistanceKm === null && q.minDurationMinutes === null &&
      q.maxAveragePace === null && q.locationKeyword === null && q.startDate === "20260901",
    JSON.stringify(q),
  );
}
{
  // THE CALL THAT WORKED. The official connector, asked for 15–25 June 2024,
  // sent exactly {"startDate":"20240615","endDate":"20240625","sportTypeCodes":[65535],"limit":50} and got the
  // athlete's runs, strength and open-water swims. Given the schema COROS
  // serves, this app must build the SAME arguments — not a plausible cousin.
  const real = tool(
    {
      startDate: { type: "string", description: "Start date" },
      endDate: { type: "string", description: "End date" },
      sportTypeCodes: { type: "array", description: "Optional COROS numeric sport type codes. Pass only numbers chosen from" },
      minDistanceKm: { type: "number", description: "Optional minimum distance in kilometers" },
      maxDistanceKm: { type: "number", description: "Optional maximum distance in kilometers" },
      minDurationMinutes: { type: "integer", description: "Optional minimum duration in minutes" },
      maxDurationMinutes: { type: "integer", description: "Optional maximum duration in minutes" },
      maxAveragePace: { type: "string", description: "Optional maximum average pace such as 5:30" },
      locationKeyword: { type: "string", description: "Optional location keyword such as Shenzhen or park name" },
      limit: { type: "integer", description: "Maximum number of records" },
    },
    ["startDate", "endDate", "sportTypeCodes", "minDistanceKm", "maxDistanceKm", "minDurationMinutes", "maxDurationMinutes", "maxAveragePace", "locationKeyword"],
  );
  const q = buildRecordQuery(real, { from: "2024-06-15", to: "2024-06-25" });
  ck(
    "query: reproduz EXATAMENTE a chamada que o conector oficial fez e funcionou",
    JSON.stringify(q) === JSON.stringify({ startDate: "20240615", endDate: "20240625", sportTypeCodes: [65535], limit: 50 }),
    JSON.stringify(q),
  );
}
{
  // The schema exactly as the live server returned it (probe output, region
  // "us"): all ten arguments "required", descriptions verbatim.
  const live = tool(
    {
      startDate: { type: "string", description: "Start date in yyyyMMdd format, defaults to 7 days ago" },
      endDate: { type: "string", description: "End date in yyyyMMdd format, defaults to today" },
      sportTypeCodes: {
        type: "array",
        description: "Optional COROS numeric sport type codes. Pass only numbers chosen from the full dubbo sport type list in the tool description; do not pass sport names or free text. Examples only: [100,101,102,103] for running, [200,201,202,203,204,205,299] for cycling, [300,301] for swimming, [65535] or null for all sports.",
      },
      minDistanceKm: { type: "number", description: "Optional minimum distance in kilometers" },
      maxDistanceKm: { type: "number", description: "Optional maximum distance in kilometers" },
      minDurationMinutes: { type: "integer", description: "Optional minimum duration in minutes" },
      maxDurationMinutes: { type: "integer", description: "Optional maximum duration in minutes" },
      maxAveragePace: { type: "string", description: "Optional maximum average pace such as 5:30" },
      locationKeyword: { type: "string", description: "Optional location keyword such as Shenzhen or park name" },
      limit: { type: "integer", description: "Maximum number of records to return, default 20" },
    },
    ["startDate", "endDate", "sportTypeCodes", "minDistanceKm", "maxDistanceKm", "minDurationMinutes", "maxDurationMinutes", "maxAveragePace", "locationKeyword", "limit"],
  );
  const q = buildRecordQuery(live, { from: "2024-06-15", to: "2024-06-25" });
  ck(
    "query: com o schema REAL do servidor, sai a mesma chamada do conector oficial",
    JSON.stringify(q) === JSON.stringify({ startDate: "20240615", endDate: "20240625", sportTypeCodes: [65535], limit: 50 }),
    JSON.stringify(q),
  );
}
{
  // An explicitly hyphenated format is honoured, not read as compact.
  const q = buildRecordQuery(
    tool({ startDate: { type: "string", description: "Start date, format yyyy-MM-dd" }, endDate: { type: "string", description: "End date, format yyyy-MM-dd" } }),
    range,
  );
  ck("query: 'yyyy-MM-dd' no schema continua sendo ISO", q.startDate === "2026-09-01" && q.endDate === "2026-10-11", JSON.stringify(q));
}
{
  // The schema COROS actually served (copied from the live error message):
  // every filter in `required`, non-nullable, and described "Optional …".
  const live = tool(
    {
      startDate: { type: "string", description: "Start date, format yyyyMMdd" },
      endDate: { type: "string", description: "End date, format yyyyMMdd" },
      sportTypeCodes: { type: "array", description: "Optional COROS numeric sport type codes. Pass only numbers chosen from" },
      minDistanceKm: { type: "number", description: "Optional minimum distance in kilometers" },
      maxDistanceKm: { type: "number", description: "Optional maximum distance in kilometers" },
      minDurationMinutes: { type: "integer", description: "Optional minimum duration in minutes" },
      maxDurationMinutes: { type: "integer", description: "Optional maximum duration in minutes" },
      maxAveragePace: { type: "string", description: "Optional maximum average pace such as 5:30" },
      locationKeyword: { type: "string", description: "Optional location keyword such as Shenzhen or park name" },
    },
    ["startDate", "endDate", "sportTypeCodes", "minDistanceKm", "maxDistanceKm", "minDurationMinutes", "maxDurationMinutes", "maxAveragePace", "locationKeyword"],
  );
  const q = buildRecordQuery(live, range);
  ck(
    "query: filtros 'required' descritos como Optional são OMITIDOS (não zerados); só o esporte vai como 'todos'",
    // A string-typed yyyyMMdd stays a string.
    Object.keys(q).sort().join(",") === "endDate,sportTypeCodes,startDate" &&
      q.startDate === "20260901" && q.endDate === "20261011" && JSON.stringify(q.sportTypeCodes) === "[65535]",
    JSON.stringify(q),
  );
}
{
  // Omission is only for what the schema itself calls optional.
  let msg = "";
  try {
    buildRecordQuery(
      tool({
        startDate: { type: "string" },
        minDistanceKm: { type: "number", description: "Optional minimum distance in kilometers" },
        userRegionCode: { type: "string", description: "Region of the account" },
      }, ["startDate", "minDistanceKm", "userRegionCode"]),
      range,
    );
  } catch (e) { msg = (e as Error).message; }
  ck(
    "query: só o NÃO-opcional continua sendo erro (e só ele é citado)",
    msg.includes("userRegionCode") && !msg.includes("minDistanceKm"),
    msg,
  );
}
{
  // `optionally` / "not optional" must not read as permission to omit.
  let msg = "";
  try {
    buildRecordQuery(tool({ zone: { type: "string", description: "Required zone; this is not optional" } }, ["zone"]), range);
  } catch (e) { msg = (e as Error).message; }
  ck("query: 'not optional' no texto NÃO autoriza omitir", msg.includes("zone"), msg);
}
{
  // `max…` as a FILTER must never be filled with a page size.
  const q = buildRecordQuery(tool({ maxAveragePace: { type: "number" }, maxDistanceKm: { type: "number" } }), range);
  ck("query: maxAveragePace/maxDistanceKm não viram limite de página", Object.keys(q).length === 0, JSON.stringify(q));
  const r = buildRecordQuery(tool({ maxResults: { type: "integer", maximum: 30 } }), range);
  ck("query: maxResults continua sendo limite", r.maxResults === 30, JSON.stringify(r));
}
{
  const q = buildRecordQuery(tool({ startDate: { type: "string" }, order: { type: "string", default: "desc" } }, ["order"]), range);
  ck("query: obrigatório com default envia o default", q.order === "desc", JSON.stringify(q));
}
{
  let msg = "";
  try {
    buildRecordQuery(
      tool({ zoneCodes: { type: "array", description: "COROS zone codes, e.g. 100 for run" }, kind: { type: "string", enum: ["a", "b"] } }, ["zoneCodes", "kind"]),
      range,
    );
  } catch (e) { msg = (e as Error).message; }
  ck(
    "query: obrigatório não-anulável é descrito por nome, tipo e texto do schema",
    msg.includes("zoneCodes (array; COROS zone codes") && msg.includes("kind (string; one of a/b)"),
    msg,
  );
}

// ── pageSizeOf ──────────────────────────────────────────────────────────────
ck("pageSize: acha o limite que o schema pediu", pageSizeOf({ startDate: "2026-09-01", limit: 50 }) === 50);
ck("pageSize: maxAveragePace não é tamanho de página", pageSizeOf({ maxAveragePace: 100, minDistanceKm: null }) === null);
ck("pageSize: sem argumento de página → null", pageSizeOf({ startDate: "2026-09-01" }) === null);

// ── parseImportRange: a janela que o atleta escolhe ─────────────────────────
{
  const now = new Date("2026-10-11T12:00:00Z");
  const reason = (a: unknown, b: unknown) => { const r = parseImportRange(a, b, now); return r.ok ? "ok" : r.reason; };

  ck("range: o treino de 20/06/2024 cabe numa janela curta", reason("2024-06-15", "2024-06-25") === "ok");
  ck("range: um dia só é válido", reason("2024-06-20", "2024-06-20") === "ok");
  ck("range: 92 dias exatos passam, 93 não", reason("2024-06-01", "2024-08-31") === "ok" && reason("2024-06-01", "2024-09-01") === "span");
  ck("range: dois anos de uma vez é recusado", reason("2024-06-20", "2026-10-11") === "span");
  ck("range: ordem invertida", reason("2024-06-25", "2024-06-15") === "order");
  ck("range: data impossível (31/02) não passa", reason("2026-02-31", "2026-03-05") === "format");
  ck("range: formato errado / vazio / tipo errado", reason("20/06/2024", "2024-06-25") === "format" && reason("", "") === "format" && reason(undefined, "2024-06-25") === "format" && reason(20240620, 20240625) === "format");
  ck("range: futuro é recusado", reason("2026-10-10", "2026-10-20") === "future");
  ck("range: hoje e amanhã (fuso à frente do UTC) passam", reason("2026-10-10", "2026-10-11") === "ok" && reason("2026-10-10", "2026-10-12") === "ok");
  ck("range: mais de 5 anos para trás é recusado", reason("2021-01-01", "2021-01-10") === "too_old" && reason("2021-10-12", "2021-10-20") === "ok");
  const r = parseImportRange("2024-06-15", "2024-06-25", now);
  ck("range: devolve as datas como vieram", r.ok && r.from === "2024-06-15" && r.to === "2024-06-25");
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
  ck("lote: diz QUAL esporte ficou de fora", b.otherSports.join() === "104", b.otherSports.join());
}
{
  // "Nothing imported" has to be able to say what was there instead.
  const hike = (n: number) => ({ id: n, sportType: 104, startTime: EPOCH_2026_10_10_1030Z, workoutTime: 600 });
  const b = mapRecords([
    hike(1), hike(2), hike(3),                                                          // same code three times
    { id: 4, sportType: 105, startTime: EPOCH_2026_10_10_1030Z, workoutTime: 600 },
    { id: 5, sportName: "Yoga", startTime: EPOCH_2026_10_10_1030Z, workoutTime: 600 },
  ]);
  ck("lote: esportes de fora sem repetição, códigos e nomes", b.otherSports.join() === "104,105,Yoga", b.otherSports.join());
  ck("lote: tudo de outro esporte → nada importado, e isso é distinguível", b.items.length === 0 && b.skipped.other_sport === 5);
  const many = mapRecords(Array.from({ length: 20 }, (_, i) => ({ id: i, sportType: 500 + i, startTime: EPOCH_2026_10_10_1030Z, workoutTime: 600 })));
  ck("lote: no máximo 8 esportes citados", many.otherSports.length === 8, String(many.otherSports.length));
  ck("lote: lista vazia quando tudo foi importado", mapRecords([{ id: 1, sportType: 100, startTime: EPOCH_2026_10_10_1030Z, workoutTime: 600 }]).otherSports.length === 0);
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
