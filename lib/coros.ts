// ────────────────────────────────────────────────────────────────────────────
//  COROS → the dashboard's own model, through COROS's OFFICIAL MCP server.
//
//  Not an API integration in the Strava sense. COROS publishes an MCP endpoint
//  and a self-service "Build on COROS MCP" track (support.coros.com, no
//  application, no approval): the athlete authorises THIS app over OAuth 2.0 and
//  the app reads that athlete's OWN data. It names "AI coaching apps" and
//  "training dashboards" as the intended builds — which is the opposite of the
//  restrictions that closed the Strava path (see lib/strava.ts, and the memory
//  note on the data-source landscape).
//
//  What the protocol looks like, taken from COROS's own reference client
//  (github.com/coroslab/COROS-MCP, skill/…/coros_mcp_login.py) rather than
//  guessed:
//    • one account lives in ONE regional cluster (EU / US / CN) and its token
//      only works there, so the region is chosen explicitly — the gateway at
//      mcp.coros.com picks by the REQUESTER's location, and a serverless
//      function's location says nothing about where the athlete signed up;
//    • the client registers itself (RFC 7591) as a public client, PKCE S256,
//      and sends `resource` on authorise;
//    • MCP is stateless over HTTP: `initialize`, then `tools/list` / `tools/call`
//      as JSON-RPC, with the reply as JSON OR as a one-event SSE stream.
//
//  What it can NOT know ahead of time: each tool's argument schema and the
//  exact shape of its records. COROS's own guidance is to read them live
//  (`tools/list`) and "do not guess fields". So the sync asks the server for the
//  schema, fills only what the schema names, reads records tolerantly, and when
//  something still doesn't line up it says WHICH field, by name, rather than
//  importing a wrong number. Values are never echoed into errors — only keys.
// ────────────────────────────────────────────────────────────────────────────

import { createHash, randomBytes } from "node:crypto";
import type { Discipline } from "./types";
import { paceFrom } from "./fit-parse";

// ── Regions ─────────────────────────────────────────────────────────────────

/** Mainland China (mcpcn) is left out on purpose: a Vercel-hosted product
 * pulling a Chinese cluster's health data is a cross-border transfer question
 * nobody here has asked yet. Add it when somebody needs it and has answered. */
export type CorosRegion = "eu" | "us";
export const COROS_REGIONS: readonly CorosRegion[] = ["eu", "us"];
export const DEFAULT_REGION: CorosRegion = "eu";

export function isCorosRegion(v: unknown): v is CorosRegion {
  return v === "eu" || v === "us";
}

const ORIGIN: Record<CorosRegion, string> = {
  eu: "https://mcpeu.coros.com",
  us: "https://mcpus.coros.com",
};

export const issuerOf = (r: CorosRegion): string => ORIGIN[r];
export const mcpUrlOf = (r: CorosRegion): string => `${ORIGIN[r]}/mcp`;

/**
 * The one origin COROS is told to send the athlete back to.
 *
 * A registered redirect_uri is an exact match, and this deployment answers on
 * several hosts (the domain, www, preview URLs). Same reason, and same
 * APP_ORIGIN, as the Strava connect route; falls back to the request's own
 * origin so local development works unconfigured.
 */
export function corosOrigin(req: Request): string {
  const configured = process.env.APP_ORIGIN?.trim().replace(/\/+$/, "");
  return configured || new URL(req.url).origin;
}

export const corosCallbackUrl = (req: Request): string => `${corosOrigin(req)}/api/app/coros/callback`;

const SCOPES = "openid offline_access mcp.tools";
const CLIENT_NAME = "MY TRAKR";
const PROTOCOL_VERSION = "2025-06-18";
const TIMEOUT_MS = 20_000;

export class CorosError extends Error {
  constructor(
    message: string,
    /** `unauthorized` is the only one a caller acts on: refresh once, retry. */
    readonly kind: "unauthorized" | "http" | "rpc" | "tool" | "schema" | "protocol",
    readonly status?: number,
  ) {
    super(message);
  }
}

// ── OAuth 2.0 + PKCE + dynamic client registration ─────────────────────────

export function challengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** RFC 7636 asks for 43–128 characters; 48 random bytes is 64 of base64url. */
export function newPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: challengeOf(verifier) };
}

interface AuthMeta {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
}

const metaCache = new Map<CorosRegion, { at: number; meta: AuthMeta }>();
const META_TTL_MS = 10 * 60_000;

async function discover(region: CorosRegion): Promise<AuthMeta> {
  const hit = metaCache.get(region);
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit.meta;

  const issuer = issuerOf(region);
  const res = await fetch(`${issuer}/.well-known/oauth-authorization-server`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new CorosError(`oauth discovery → HTTP ${res.status}`, "http", res.status);
  const j = (await res.json()) as Partial<AuthMeta>;

  // Endpoints are read from the server's own metadata, but only trusted when
  // they stay on the issuer's origin — a token request is where the PKCE
  // verifier and the refresh token travel.
  const origin = new URL(issuer).origin;
  for (const k of ["authorization_endpoint", "token_endpoint", "registration_endpoint"] as const) {
    const v = j[k];
    if (typeof v !== "string" || new URL(v).origin !== origin) {
      throw new CorosError(`oauth metadata: ${k} missing or off-origin`, "protocol");
    }
  }
  const meta = j as AuthMeta;
  metaCache.set(region, { at: Date.now(), meta });
  return meta;
}

export async function registerClient(region: CorosRegion, redirectUri: string): Promise<string> {
  const meta = await discover(region);
  const res = await fetch(meta.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: SCOPES,
      token_endpoint_auth_method: "none",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new CorosError(`client registration → HTTP ${res.status}`, "http", res.status);
  }
  const j = (await res.json()) as { client_id?: unknown };
  if (typeof j.client_id !== "string" || !j.client_id) {
    throw new CorosError("client registration returned no client_id", "protocol");
  }
  return j.client_id;
}

export async function authorizeUrl(
  region: CorosRegion,
  p: { clientId: string; redirectUri: string; state: string; challenge: string },
): Promise<string> {
  const meta = await discover(region);
  const q = new URLSearchParams({
    response_type: "code",
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: SCOPES,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    // RFC 8707: which resource the token is for. COROS's own client sends it.
    resource: mcpUrlOf(region),
  });
  return `${meta.authorization_endpoint}?${q}`;
}

export interface CorosTokens {
  access_token: string;
  refresh_token: string | null;
  /** Unix seconds — same unit the device_links reader hands back. */
  expires_at: number;
  scope: string | null;
}

async function tokenRequest(region: CorosRegion, form: Record<string, string>): Promise<CorosTokens> {
  const meta = await discover(region);
  const res = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    // The OAuth `error` code ("invalid_grant") is safe and useful; the body can
    // carry anything, so nothing else from it goes into the message.
    let code = "";
    try { code = String(((await res.json()) as { error?: unknown }).error ?? ""); } catch { /* not JSON */ }
    throw new CorosError(`token endpoint → HTTP ${res.status}${code ? ` (${code})` : ""}`, "http", res.status);
  }
  const j = (await res.json()) as {
    access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown;
  };
  if (typeof j.access_token !== "string" || !j.access_token) {
    throw new CorosError("token endpoint returned no access_token", "protocol");
  }
  const ttl = typeof j.expires_in === "number" && j.expires_in > 0 ? j.expires_in : 3600;
  return {
    access_token: j.access_token,
    refresh_token: typeof j.refresh_token === "string" ? j.refresh_token : null,
    expires_at: Math.floor(Date.now() / 1000) + ttl,
    scope: typeof j.scope === "string" ? j.scope : null,
  };
}

export const exchangeCode = (
  region: CorosRegion,
  p: { clientId: string; code: string; redirectUri: string; verifier: string },
) =>
  tokenRequest(region, {
    grant_type: "authorization_code",
    client_id: p.clientId,
    code: p.code,
    redirect_uri: p.redirectUri,
    code_verifier: p.verifier,
  });

export const refreshTokens = (region: CorosRegion, p: { clientId: string; refreshToken: string }) =>
  tokenRequest(region, {
    grant_type: "refresh_token",
    client_id: p.clientId,
    refresh_token: p.refreshToken,
  });

// ── MCP over HTTP ───────────────────────────────────────────────────────────

interface RpcBody {
  result?: unknown;
  error?: { code?: number; message?: string };
}

/** The reply is JSON, or an SSE stream whose last `data:` event is the JSON. */
export function parseRpcBody(raw: string, contentType: string): RpcBody {
  if (!raw.trim()) return {};
  if (!contentType.includes("text/event-stream")) return JSON.parse(raw) as RpcBody;

  let last: string | null = null;
  let buf: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line === "") {
      if (buf.length) { last = buf.join("\n"); buf = []; }
    } else if (line.startsWith("data:")) {
      buf.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (buf.length) last = buf.join("\n");
  return last ? (JSON.parse(last) as RpcBody) : {};
}

async function rpc(
  region: CorosRegion,
  accessToken: string,
  id: number,
  method: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const res = await fetch(mcpUrlOf(region), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) throw new CorosError("mcp rejected the access token", "unauthorized", 401);
  const raw = await res.text();
  if (!res.ok) throw new CorosError(`mcp ${method} → HTTP ${res.status}`, "http", res.status);

  let body: RpcBody;
  try {
    body = parseRpcBody(raw, res.headers.get("content-type") ?? "");
  } catch {
    throw new CorosError(`mcp ${method}: reply was not JSON`, "protocol");
  }
  if (body.error) throw new CorosError(`mcp ${method}: ${String(body.error.message ?? "error").slice(0, 160)}`, "rpc");
  return body.result;
}

/** One argument of a tool, as JSON Schema spells it. `anyOf`/`oneOf`/`nullable`
 * are here because "optional" is often written as "required, but may be null"
 * — the shape strict-mode clients (ChatGPT apps) force on a server. */
export interface McpProp {
  type?: string | string[];
  description?: string;
  format?: string;
  maximum?: number;
  default?: unknown;
  enum?: unknown[];
  nullable?: boolean;
  anyOf?: McpProp[];
  oneOf?: McpProp[];
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, McpProp>;
    required?: string[];
  };
}

interface ToolResult {
  content?: { type?: string; text?: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

export class CorosSession {
  private seq = 1;
  constructor(readonly region: CorosRegion, readonly accessToken: string) {}

  /** The stateless flow COROS documents: initialize, then call. No
   * Mcp-Session-Id, and no notifications/initialized. */
  async init(): Promise<void> {
    await rpc(this.region, this.accessToken, this.seq++, "initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: CLIENT_NAME, version: "1.0.0" },
    });
  }

  async listTools(): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const r = (await rpc(this.region, this.accessToken, this.seq++, "tools/list", cursor ? { cursor } : {})) as {
        tools?: McpTool[]; nextCursor?: string;
      } | undefined;
      tools.push(...(r?.tools ?? []));
      if (!r?.nextCursor) break;
      cursor = r.nextCursor;
    }
    return tools;
  }

  /** Returns the tool's payload (structured, else parsed text). A tool-level
   * failure is `isError` inside a 200 — it must not read as "no records". */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const r = (await rpc(this.region, this.accessToken, this.seq++, "tools/call", { name, arguments: args })) as ToolResult | undefined;
    if (!r) throw new CorosError(`tool ${name}: empty result`, "protocol");
    if (r.isError) {
      const text = (r.content ?? []).map((c) => c.text ?? "").join(" ").slice(0, 200);
      throw new CorosError(`tool ${name} refused: ${text || "no detail"}`, "tool");
    }
    return toolPayload(r);
  }
}

export function toolPayload(r: { content?: { type?: string; text?: string }[]; structuredContent?: unknown }): unknown {
  if (r.structuredContent !== undefined && r.structuredContent !== null) return r.structuredContent;
  const texts = (r.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string);
  for (const t of texts) {
    try { return JSON.parse(t); } catch { /* try the next block */ }
  }
  // A sentence around a JSON document ("Found 3 records: [ … ]") is still a
  // JSON document: read the span from the first bracket to the last matching
  // one before giving up and handing back prose.
  for (const t of texts) {
    const embedded = embeddedJson(t);
    if (embedded !== undefined) return embedded;
  }
  return texts.join("\n");
}

function embeddedJson(text: string): unknown {
  const open = text.search(/[[{]/);
  if (open < 0) return undefined;
  const closer = text[open] === "[" ? "]" : "}";
  const close = text.lastIndexOf(closer);
  if (close <= open) return undefined;
  try {
    const v: unknown = JSON.parse(text.slice(open, close + 1));
    // Only something that can be a result: a non-empty list OF OBJECTS, or an
    // object with fields. "see [1] and [2]" is valid JSON and is prose — taking
    // it for data would turn an unreadable reply into a confident "no records".
    if (Array.isArray(v)) return v.length > 0 && v.every((x) => typeof x === "object" && x !== null && !Array.isArray(x)) ? v : undefined;
    return typeof v === "object" && v !== null && Object.keys(v).length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * What a tool result was, for saying so when it held no records.
 *
 * "No records" is only an answer when the reply was STRUCTURED. A reply of
 * prose this code cannot read is not "nothing happened" — it is "I could not
 * read it". Reporting that as an empty window is how a connection that works
 * looks broken, and it would stamp a sync that never understood anything.
 */
export function describePayload(payload: unknown): { understood: boolean; note: string | null } {
  if (typeof payload === "string") {
    const text = payload.replace(/\s+/g, " ").trim();
    // The list's own header says how many records it holds: "(0 records)" is
    // an answer, not something unread.
    if (declaredRecordCount(payload) === 0) return { understood: true, note: text.slice(0, 240) };
    return { understood: false, note: text ? text.slice(0, 240) : null };
  }
  if (Array.isArray(payload)) return { understood: true, note: null };
  if (isRec(payload)) {
    // Names only, never values.
    const keys = Object.keys(payload).slice(0, 10);
    return { understood: true, note: keys.length ? `{ ${keys.join(", ")} }` : null };
  }
  return { understood: false, note: null };
}

// ── Reading the schema COROS actually serves ───────────────────────────────

const tokensOf = (name: string): string[] =>
  name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

const FROM_WORDS = new Set(["start", "from", "begin", "since", "after"]);
const TO_WORDS = new Set(["end", "to", "until", "before"]);
const DATEISH = new Set(["date", "day", "time", "timestamp", "at", "datetime"]);
const LIMIT_WORDS = new Set(["limit", "size", "count", "top", "pagesize"]);

/**
 * COROS's "every sport" value for sportTypeCodes. Taken from a real call the
 * official connector made for this tool, which returned the athlete's June 2024
 * runs, strength and open-water swims: {"sportTypeCodes":[65535], …}.
 *
 * Leaving the argument OUT is not equivalent — the same window came back empty
 * from this app while it was omitted.
 */
const ALL_SPORTS = 65535;
const isSportCodesName = (tokens: string[]): boolean =>
  tokens.includes("sport") && (tokens.includes("codes") || tokens.includes("types"));

/** Page size when the schema gives no maximum — the one the official call used. */
const DEFAULT_PAGE_SIZE = 50;
const LIMIT_NOUNS = new Set(["results", "items", "records", "rows", "activities", "workouts", "per", "page"]);

/** A page-size argument. "max" alone is NOT enough: `maxAveragePace` and
 * `maxDistanceKm` are filters, and filling them with a page size would exclude
 * every activity and read as "no workouts" — so "max" only counts when what
 * follows is a count noun (maxResults, maxItems). */
function isLimitName(tokens: string[]): boolean {
  if (tokens.some((w) => LIMIT_WORDS.has(w))) return true;
  return tokens[0] === "max" && tokens.length > 1 && tokens.slice(1).every((w) => LIMIT_NOUNS.has(w));
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function dayRange(sinceDays: number, now = new Date()): { from: string; to: string } {
  return { from: isoDay(new Date(now.getTime() - sinceDays * 86_400_000)), to: isoDay(now) };
}

/** One bound of the window, in whichever shape the schema's own text asks for. */
function formatBound(
  iso: string,
  edge: "from" | "to",
  def: { type?: string | string[]; description?: string; format?: string },
): string | number {
  const type = Array.isArray(def.type) ? def.type[0] : def.type;
  const desc = (def.description ?? "").toLowerCase();
  const compact = iso.replace(/-/g, "");

  // An explicitly hyphenated format is checked FIRST: the test below strips
  // hyphens, and would read "yyyy-MM-dd" as the compact form.
  if (/yyyy-mm-dd/.test(desc)) return iso;
  if (/yyyymmdd/.test(desc.replace(/[-_\s]/g, ""))) {
    return type === "integer" || type === "number" ? Number(compact) : compact;
  }
  if (def.format === "date-time" || /date-?time|iso ?8601/.test(desc)) {
    return edge === "from" ? `${iso}T00:00:00Z` : `${iso}T23:59:59Z`;
  }
  if (/epoch|unix|timestamp/.test(desc) || ((type === "integer" || type === "number") && /second|milli/.test(desc))) {
    const base = Date.parse(`${iso}T${edge === "from" ? "00:00:00" : "23:59:59"}Z`);
    return /milli/.test(desc) ? base : Math.floor(base / 1000);
  }
  if (type === "integer" || type === "number") return Number(compact);
  // A string with no format hint. COROS spells its days yyyyMMdd — the call the
  // official connector made for this very tool was {"startDate":"20240615",
  // "endDate":"20240625"} — so that is the default, not ISO.
  return compact;
}

const variantsOf = (def: McpProp): McpProp[] => [...(def.anyOf ?? []), ...(def.oneOf ?? [])];

/** The first non-null JSON type, looking through `anyOf`/`oneOf`. */
function typeOf(def: McpProp): string | undefined {
  const own = (Array.isArray(def.type) ? def.type : def.type ? [def.type] : []).find((t) => t !== "null");
  if (own) return own;
  for (const v of variantsOf(def)) {
    const t = typeOf(v);
    if (t) return t;
  }
  return undefined;
}

/** Whether `null` is an accepted value — the way a "required" argument that is
 * semantically a filter says "no filter". */
function isNullable(def: McpProp): boolean {
  if (def.nullable === true || def.type === "null") return true;
  if (Array.isArray(def.type) && def.type.includes("null")) return true;
  return variantsOf(def).some(isNullable);
}

/**
 * The schema calls it required, its own description calls it optional.
 *
 * COROS's records tool lists every filter in `required` (the shape a server
 * gets when parameters are enumerated without being marked optional) while each
 * description starts "Optional …". Real clients — Claude and ChatGPT, which
 * COROS documents as working — leave them out, so omitting is what the server
 * is built to receive. Nothing is invented: an argument is left out, not filled
 * with a sentinel that might mean something.
 */
function isDescribedOptional(def: McpProp): boolean {
  // STARTS with "Optional" — which is how COROS words every one of them. A
  // mention anywhere in the text is not enough: "this is not optional" contains
  // the word and means the opposite.
  return /^\s*[[(]?\s*optional\b/i.test(def.description ?? "");
}

/** An argument described by NAME and schema metadata — never by a value. */
function describeProp(name: string, def?: McpProp): string {
  if (!def) return name;
  const bits = [`${typeOf(def) ?? "?"}${isNullable(def) ? "|null" : ""}`];
  if (def.enum?.length) bits.push(`one of ${def.enum.slice(0, 6).map(String).join("/")}`);
  if (def.description) bits.push(def.description.replace(/\s+/g, " ").trim().slice(0, 70));
  return `${name} (${bits.join("; ")})`;
}

/**
 * The arguments for the records tool, built ONLY from what its schema names.
 *
 * A required argument this code has no honest value for is, in order:
 *   1. sent as its declared default;
 *   2. sent as `null` when the schema allows null;
 *   3. left out when its own description says "Optional" (COROS lists every
 *      filter as required and describes each as optional — see
 *      isDescribedOptional).
 * Anything else throws a `schema` error describing each argument by name, type
 * and the schema's own words — never by a value — so the first real connection
 * shows exactly what the live schema wanted. A made-up sentinel (0, "", []) is
 * NOT sent: for "max pace" it would silently filter every activity out and read
 * as "no workouts".
 */
export function buildRecordQuery(
  tool: McpTool,
  range: { from: string; to: string },
): Record<string, unknown> {
  const props = tool.inputSchema?.properties ?? {};
  const required = new Set(tool.inputSchema?.required ?? []);
  const args: Record<string, unknown> = {};

  for (const [name, def] of Object.entries(props)) {
    const t = tokensOf(name);
    const type = typeOf(def);
    const dateish = t.some((w) => DATEISH.has(w)) || t.length === 1;
    const isFrom = t.some((w) => FROM_WORDS.has(w));
    const isTo = t.some((w) => TO_WORDS.has(w));

    const bound = { ...def, type };

    if (dateish && isFrom && !isTo) args[name] = formatBound(range.from, "from", bound);
    else if (dateish && isTo && !isFrom) args[name] = formatBound(range.to, "to", bound);
    else if (type === "array" && isSportCodesName(t)) args[name] = [ALL_SPORTS];
    else if ((type === "integer" || type === "number") && isLimitName(t)) {
      args[name] = Math.min(def.maximum ?? DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE);
    } else if ((type === "integer" || type === "number") && t.includes("page") && required.has(name)) {
      args[name] = def.default ?? 1;
    }
  }

  // Required but not ours to set: a declared default, else null when the schema
  // allows it. Otherwise it is named, with what the schema says about it.
  const missing: string[] = [];
  for (const name of required) {
    if (name in args) continue;
    const def = props[name];
    if (def?.default !== undefined) args[name] = def.default;
    else if (def && isNullable(def)) args[name] = null;
    else if (def && isDescribedOptional(def)) continue;
    else missing.push(describeProp(name, def));
  }
  if (missing.length) {
    throw new CorosError(
      `${tool.name} requires argument(s) this app can't fill: ${missing.join("; ")}`,
      "schema",
    );
  }
  return args;
}

/** The page size `buildRecordQuery` put in the arguments, or null when the
 * schema has no page-size argument. A result that fills it may be cut short. */
export function pageSizeOf(args: Record<string, unknown>): number | null {
  for (const [name, v] of Object.entries(args)) {
    if (typeof v === "number" && isLimitName(tokensOf(name))) return v;
  }
  return null;
}

// ── An athlete-chosen window (the "import a period" button) ─────────────────

/** Widest window one request may ask for. Three months keeps a single call
 * inside any per-query range COROS may enforce and inside a function's time
 * budget; older history is just several imports. */
export const MAX_IMPORT_DAYS = 92;
/** How far back a window may start. */
export const MAX_LOOKBACK_YEARS = 5;

export type ImportRangeResult =
  | { ok: true; from: string; to: string }
  | { ok: false; reason: "format" | "order" | "future" | "span" | "too_old" };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A real calendar day, not just something shaped like one (2026-02-31). */
function parseDay(v: unknown): number | null {
  if (typeof v !== "string" || !DAY_RE.test(v)) return null;
  const ms = Date.parse(`${v}T00:00:00Z`);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== v ? null : ms;
}

export function parseImportRange(from: unknown, to: unknown, now = new Date()): ImportRangeResult {
  const a = parseDay(from);
  const b = parseDay(to);
  if (a === null || b === null) return { ok: false, reason: "format" };
  if (a > b) return { ok: false, reason: "order" };
  // One day of slack: an athlete east of UTC can legitimately be "today" a few
  // hours before the server's date turns over.
  if (b > Date.parse(`${isoDay(now)}T00:00:00Z`) + 86_400_000) return { ok: false, reason: "future" };
  if ((b - a) / 86_400_000 + 1 > MAX_IMPORT_DAYS) return { ok: false, reason: "span" };
  const oldest = new Date(now);
  oldest.setUTCFullYear(oldest.getUTCFullYear() - MAX_LOOKBACK_YEARS);
  if (a < Date.parse(`${isoDay(oldest)}T00:00:00Z`)) return { ok: false, reason: "too_old" };
  return { ok: true, from: from as string, to: to as string };
}

// ── Reading the records ─────────────────────────────────────────────────────

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

const CONTAINER_KEYS = ["records", "list", "items", "activities", "sportrecords", "datalist", "rows", "data", "result"];

// ── The formatted list querySportRecords actually returns ───────────────────
//
//   Sport Records — 2024-05-01 to 2024-06-30 (40 records)
//   ========================
//   1. Outdoor Run — 2024-06-20
//      Location: Run Start
//      Coordinates: 44.367001, 7.536000
//      Time Window: startTimestamp=1718911717 | endTimestamp=1718913889
//      Duration: 36:12
//      …
//
// Observed from a real reply (the first lines — the rest is read by label, so a
// field this code has not seen is skipped rather than failing the whole list).
// Prose for a language model; the records are rebuilt from it here.

const TITLE_LINE = /^\s*\d+[.)]\s+(.+?)\s+[—–-]\s+(\d{4}-\d{2}-\d{2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?\s*$/;
const LABELLED_LINE = /^\s*([A-Za-z][A-Za-z0-9 _/.-]{0,31}?)\s*[:=]\s*(.+?)\s*$/;

/** How many records the header says the reply holds, or null. */
export function declaredRecordCount(text: string): number | null {
  const m = /\((\d+)\s+records?\)/i.exec(text.slice(0, 400));
  return m ? Number(m[1]) : null;
}

/** "5.2 km" / "800 m" / "3.1 mi" → kilometres, or null. */
function kmFrom(raw: string): number | null {
  const m = /(-?\d+(?:[.,]\d+)?)\s*(km|kilomet\w*|m|meters?|metres?|mi|miles?)?\b/i.exec(raw);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] ?? "km").toLowerCase();
  if (unit.startsWith("mi")) return n * 1.609344;
  if (unit === "m" || unit.startsWith("meter") || unit.startsWith("metre")) return n / 1000;
  return n;
}

export function parseSportRecordsText(text: string): Rec[] {
  const records: Rec[] = [];
  let current: Rec | null = null;

  for (const line of text.split(/\r?\n/)) {
    const title = TITLE_LINE.exec(line);
    if (title) {
      current = { sportName: title[1].trim(), date: title[2] };
      records.push(current);
      continue;
    }
    if (!current) continue;

    // One line may carry several fields: "Duration: 36:12 | Distance: 6.2 km".
    for (const segment of line.split(/\s+\|\s+/)) {
    const kv = LABELLED_LINE.exec(segment);
    if (!kv) continue;
    const key = kv[1].toLowerCase().replace(/[^a-z0-9]/g, "");
    const value = kv[2];

    // Deliberately NOT carried: where the athlete trained (location and
    // coordinates). Nothing downstream needs it, and a home address is not a
    // thing to keep because it happened to be in the reply.
    if (key === "location" || key === "coordinates" || key === "coords") continue;

    if (key === "timewindow" || key === "time") {
      const s = /startTimestamp\s*=\s*(\d+)/i.exec(value);
      const e = /endTimestamp\s*=\s*(\d+)/i.exec(value);
      if (s) current.startTimestamp = Number(s[1]);
      if (e) current.endTimestamp = Number(e[1]);
      if (s || e) continue;
    }
    if (key === "duration" || key === "workouttime" || key === "totaltime" || key === "movingtime") {
      current.duration = value;
    } else if (key === "distance" || key === "totaldistance") {
      const km = kmFrom(value);
      if (km !== null) current.distanceKm = km;
    } else if (key === "labelid" || key === "activityid") {
      current.labelId = value;
    } else if (key === "sporttype" || key === "sportcode") {
      const n = Number(value);
      if (Number.isInteger(n)) current.sportType = n;
    } else if (key === "starttimestamp" || key === "endtimestamp") {
      const n = Number(value);
      if (Number.isFinite(n)) current[key === "starttimestamp" ? "startTimestamp" : "endTimestamp"] = n;
    }
    // Everything else (pace, heart rate, sets…) is read by nothing yet.
    }
  }

  // Without a labelId the start instant is the identity: stable for a given
  // activity and never reused by another.
  for (const r of records) {
    if (r.labelId === undefined && typeof r.startTimestamp === "number") r.id = `ts${r.startTimestamp}`;
  }
  return records;
}

/** The array of activity objects inside whatever envelope the tool used. */
export function findRecords(payload: unknown, depth = 0): Rec[] {
  // querySportRecords answers in a formatted LIST, not JSON (see
  // parseSportRecordsText) — the reply that used to read as "no activities".
  if (typeof payload === "string") return parseSportRecordsText(payload);
  if (Array.isArray(payload)) return payload.filter(isRec);
  if (!isRec(payload) || depth > 3) return [];

  const keys = Object.keys(payload);
  const ordered = [
    ...CONTAINER_KEYS.flatMap((c) => keys.filter((k) => k.toLowerCase() === c)),
    ...keys.filter((k) => !CONTAINER_KEYS.includes(k.toLowerCase())),
  ];
  for (const k of ordered) {
    const found = findRecords(payload[k], depth + 1);
    if (found.length) return found;
  }
  return [];
}

/** Lower-cased, separator-free key lookup: startTime == start_time == StartTime. */
function indexOf(rec: Rec): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const [k, v] of Object.entries(rec)) m.set(k.toLowerCase().replace(/[^a-z0-9]/g, ""), v);
  return m;
}

function pick(ix: Map<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const v = ix.get(k);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

function seconds(v: unknown): number | null {
  if (typeof v === "string") return durationText(v);
  return num(v);
}

/**
 * A duration as COROS's text list writes it. Seen: "36:12". Also read:
 * "1:02:15", "00:36:12.4", "36:12 (moving 35:40)" (first clock wins),
 * "1h 2m 15s", "36 min 12 s", "36m12s", a bare "2172" (seconds).
 */
export function durationText(raw: string): number | null {
  const s = raw.trim();
  const clock = /(\d+):(\d{2})(?::(\d{2}))?(?:[.,]\d+)?/.exec(s);
  if (clock) {
    return clock[3] !== undefined
      ? +clock[1] * 3600 + +clock[2] * 60 + +clock[3]
      : +clock[1] * 60 + +clock[2];
  }
  // (?![a-z]) rather than \b: in "36m12s" a digit follows the unit.
  const h = /(\d+(?:[.,]\d+)?)\s*(?:hours?|hrs|hr|h)(?![a-z])/i.exec(s);
  const m = /(\d+(?:[.,]\d+)?)\s*(?:minutes?|mins|min|m)(?![a-z])/i.exec(s);
  const sec = /(\d+(?:[.,]\d+)?)\s*(?:seconds?|secs|sec|s)(?![a-z])/i.exec(s);
  if (h || m || sec) {
    const n = (x: RegExpExecArray | null) => (x ? Number(x[1].replace(",", ".")) : 0);
    const total = Math.round(n(h) * 3600 + n(m) * 60 + n(sec));
    return total > 0 ? total : null;
  }
  return /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : null;
}

/** The SHAPE of a value — every digit a 9 — so an unreadable format can be
 * shown without showing the athlete's numbers. */
export const shapeOf = (v: unknown): string => String(v).replace(/\d/g, "9").slice(0, 24);

/** The athlete's local calendar day, or null. Local fields win; an epoch plus
 * a time-zone offset is the fallback; a bare epoch is read as UTC. */
export function localDateOf(rec: Rec): string | null {
  const ix = indexOf(rec);

  const local = pick(ix, ["starttimelocal", "localstarttime", "startlocal", "startdatelocal"]);
  if (typeof local === "string" && /^\d{4}-\d{2}-\d{2}/.test(local)) return local.slice(0, 10);

  const day = pick(ix, ["happenday", "startday", "day", "date", "startdate"]);
  if (day !== undefined) {
    const s = String(day);
    if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  }

  const raw = num(pick(ix, ["starttime", "starttimestamp", "startat", "timestamp"]));
  if (raw !== null && raw > 0) {
    const ms = raw < 1e11 ? raw * 1000 : raw;
    // COROS reports the offset in quarter-hours (32 = UTC+8). Only applied
    // when it is present AND in the range that unit allows.
    const q = num(pick(ix, ["starttimezone", "timezone", "tzoffset"]));
    const shift = q !== null && Number.isInteger(q) && q >= -48 && q <= 56 ? q * 15 * 60_000 : 0;
    return new Date(ms + shift).toISOString().slice(0, 10);
  }
  return null;
}

/** COROS activity-record codes (100 = run, 200 = bike — the same codes its own
 * docs contrast with the 1/2/5 used for training courses). Anything not clearly
 * one of the four disciplines this product programs is left out, so a hike or a
 * yoga session can't quietly fill the calendar. */
export function disciplineOf(rec: Rec): Discipline | null {
  const ix = indexOf(rec);
  const v = pick(ix, ["sporttype", "sport", "sportcode", "mode", "activitytype", "type"]);

  const code = num(v);
  if (code !== null) {
    if (code >= 100 && code <= 103) return "run";
    if (code >= 200 && code <= 299) return "bike";
    if (code >= 300 && code <= 399) return "swim";
    if (code === 402) return "strength";
    return null;
  }
  const t = String(pick(ix, ["sportname", "sporttype", "type"]) ?? "").toLowerCase();
  if (t.includes("swim")) return "swim";
  if (t.includes("bike") || t.includes("cycl") || t.includes("ride")) return "bike";
  if (t.includes("run") && !t.includes("hike")) return "run";
  if (t.includes("strength")) return "strength";
  return null;
}

function distanceKm(ix: Map<string, unknown>, d: Discipline): number | null {
  const km = num(pick(ix, ["distancekm", "totaldistancekm"]));
  if (km !== null) return km > 0 ? km : null;

  const raw = num(pick(ix, ["distance", "totaldistance", "dist", "distancemeters", "distancem"]));
  if (raw === null || raw <= 0) return null;
  // Unit isn't labelled. A swim is metres at any realistic size; for run/bike a
  // value under 500 is far likelier kilometres than a sub-500 m "activity".
  const metres = d === "swim" || raw >= 500;
  return metres ? raw / 1000 : raw;
}

export interface ImportedCorosWorkout {
  external_id: string;
  date: string;
  discipline: Discipline;
  title: string;
  actual_duration_min: number;
  actual_distance_km: number | null;
  actual_pace: string | null;
  actual_power_watts: string | null;
}

export type SkipReason = "no_id" | "no_date" | "other_sport" | "no_duration";

/** The sport of a record as COROS labelled it — a numeric code, or a short
 * name — for saying WHICH sports were left out. A code or a sport name, never
 * a value about the athlete. */
function sportLabelOf(rec: Rec): number | string | null {
  const ix = indexOf(rec);
  const v = pick(ix, ["sporttype", "sport", "sportcode", "mode", "activitytype", "type", "sportname"]);
  const n = num(v);
  if (n !== null) return n;
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 24) : null;
}

export function mapRecord(rec: Rec): { item: ImportedCorosWorkout } | { skip: SkipReason; sport?: number | string | null } {
  const ix = indexOf(rec);

  const id = pick(ix, ["labelid", "activityid", "id", "workoutid", "sportid", "recordid"]);
  if (id === undefined) return { skip: "no_id" };

  const date = localDateOf(rec);
  if (!date) return { skip: "no_date" };

  const discipline = disciplineOf(rec);
  if (!discipline) return { skip: "other_sport", sport: sportLabelOf(rec) };

  const secs = seconds(pick(ix, ["workouttime", "movingtime", "totaltime", "duration", "timertime", "elapsedtime"]));
  if (secs === null || secs <= 0) return { skip: "no_duration" };

  const km = distanceKm(ix, discipline);
  const watts = num(pick(ix, ["avgpower", "averagepower", "poweravg"]));
  const name = pick(ix, ["name", "title", "sportname"]);

  return {
    item: {
      external_id: `coros:${String(id)}`,
      date,
      discipline,
      title: typeof name === "string" && name.trim() ? name.trim() : discipline,
      actual_duration_min: Math.round((secs / 60) * 10) / 10,
      actual_distance_km: km !== null ? Math.round(km * 100) / 100 : null,
      actual_pace: km !== null ? paceFrom(km * 1000, secs, discipline) : null,
      actual_power_watts: discipline === "bike" && watts && watts > 0 ? `${Math.round(watts)}W` : null,
    },
  };
}

export interface MappedBatch {
  items: ImportedCorosWorkout[];
  skipped: Record<SkipReason, number>;
  /** Distinct sport codes/names among the records left out as "other sport",
   * so "nothing imported" can say what was there instead. At most 8. */
  otherSports: (number | string)[];
  /** Digit-masked formats of durations this code could not read. */
  durationShapes: string[];
  /** KEYS of the first record — never values — so a mismatch is debuggable
   * from the dashboard without putting an athlete's data in a log. */
  sampleKeys: string[];
}

export function mapRecords(records: Rec[]): MappedBatch {
  const skipped: Record<SkipReason, number> = { no_id: 0, no_date: 0, other_sport: 0, no_duration: 0 };
  const items: ImportedCorosWorkout[] = [];
  const otherSports: (number | string)[] = [];
  for (const r of records) {
    const m = mapRecord(r);
    if ("item" in m) items.push(m.item);
    else {
      skipped[m.skip]++;
      if (m.skip === "other_sport" && m.sport != null && !otherSports.includes(m.sport) && otherSports.length < 8) {
        otherSports.push(m.sport);
      }
    }
  }
  // Formats (digits masked) of durations that could not be read.
  const durationShapes = [
    ...new Set(
      records
        .filter((r) => "skip" in mapRecord(r) && (mapRecord(r) as { skip: SkipReason }).skip === "no_duration")
        .map((r) => r.duration ?? r.workoutTime ?? r.totalTime)
        .filter((v) => v !== undefined)
        .map(shapeOf),
    ),
  ].slice(0, 4);
  return { items, skipped, otherSports, durationShapes, sampleKeys: records[0] ? Object.keys(records[0]).slice(0, 30) : [] };
}
