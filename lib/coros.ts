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
  return texts.join("\n");
}

// ── Reading the schema COROS actually serves ───────────────────────────────

const tokensOf = (name: string): string[] =>
  name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

const FROM_WORDS = new Set(["start", "from", "begin", "since", "after"]);
const TO_WORDS = new Set(["end", "to", "until", "before"]);
const DATEISH = new Set(["date", "day", "time", "timestamp", "at", "datetime"]);
const LIMIT_WORDS = new Set(["limit", "size", "count", "top", "pagesize"]);
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
  return iso;
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
 * A required argument this code has no honest value for is sent as `null` when
 * the schema allows null (filters such as a minimum distance are "required"
 * only so a strict client lists them), or as its declared default. Anything
 * else throws a `schema` error describing each argument by name, type and the
 * schema's own words — never by a value — so the first real connection shows
 * exactly what the live schema wanted. A made-up sentinel (0, "", []) is NOT
 * sent: for "max pace" it would silently filter every activity out and read as
 * "no workouts".
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
    else if ((type === "integer" || type === "number") && isLimitName(t)) {
      args[name] = Math.min(def.maximum ?? 100, 100);
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

// ── Reading the records ─────────────────────────────────────────────────────

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

const CONTAINER_KEYS = ["records", "list", "items", "activities", "sportrecords", "datalist", "rows", "data", "result"];

/** The array of activity objects inside whatever envelope the tool used. */
export function findRecords(payload: unknown, depth = 0): Rec[] {
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
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
    if (m) return m[3] !== undefined ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
  }
  return num(v);
}

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

export function mapRecord(rec: Rec): { item: ImportedCorosWorkout } | { skip: SkipReason } {
  const ix = indexOf(rec);

  const id = pick(ix, ["labelid", "activityid", "id", "workoutid", "sportid", "recordid"]);
  if (id === undefined) return { skip: "no_id" };

  const date = localDateOf(rec);
  if (!date) return { skip: "no_date" };

  const discipline = disciplineOf(rec);
  if (!discipline) return { skip: "other_sport" };

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
  /** KEYS of the first record — never values — so a mismatch is debuggable
   * from the dashboard without putting an athlete's data in a log. */
  sampleKeys: string[];
}

export function mapRecords(records: Rec[]): MappedBatch {
  const skipped: Record<SkipReason, number> = { no_id: 0, no_date: 0, other_sport: 0, no_duration: 0 };
  const items: ImportedCorosWorkout[] = [];
  for (const r of records) {
    const m = mapRecord(r);
    if ("item" in m) items.push(m.item);
    else skipped[m.skip]++;
  }
  return { items, skipped, sampleKeys: records[0] ? Object.keys(records[0]).slice(0, 30) : [] };
}
