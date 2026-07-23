// Vercel serverless entry for the MY TRAKR coach MCP server.
// Same logic as src/index.ts, but as a function (Vercel runs functions, not a
// long-lived listener). Deploy this folder as its own Vercel project; set
// DATABASE_URL (app_writer, via the Supabase transaction pooler) as a secret.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { resolveTenant } from "../src/auth.js";
import { registerTools } from "../src/tools.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // CORS preflight. Clients that reach us from a browser context (ChatGPT's
  // connector UI among them) send OPTIONS first and never attempt the POST if
  // it fails — which looked like "the connector just doesn't work".
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, mcp-session-id, mcp-protocol-version");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.status(204).end();
    return;
  }

  // Safe to allow any origin: the account key is the only credential and it
  // travels in the request, never in a cookie, so there's no ambient authority
  // for another site to borrow.
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "POST") {
    // Spec-compliant: no SSE stream on this endpoint, so GET gets 405. Same for
    // DELETE — the server is stateless and has no session to terminate.
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  // Auth: account API key from the Authorization header (Bearer) OR the ?key=
  // query param — the latter lets URL-only clients (e.g. Claude Desktop custom
  // connectors, which don't send a static Bearer header) authenticate.
  const auth = req.headers["authorization"];
  const headerKey = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const queryKey = typeof req.query?.key === "string" ? req.query.key : null;
  const key = headerKey ?? queryKey;
  const tenantId = key ? await resolveTenant(key) : null;
  if (!tenantId) {
    res.status(401).json({ error: "invalid or missing account key" });
    return;
  }

  // The transport rejects (406) any client that doesn't accept BOTH
  // application/json and text/event-stream — spec-correct, but plenty of real
  // clients send only application/json, or */*, and get a wall instead of the
  // tool list. We never stream on this endpoint, so relaxing it costs nothing:
  // rewrite the header to what the transport insists on.
  //
  // Both copies have to be patched. Hono converts the Node request into a Web
  // Request and reads it via headers.get(), so mutating req.headers alone left
  // the check still failing on the raw list.
  const NEEDED = "application/json, text/event-stream";
  const accept = String(req.headers.accept ?? "");
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    req.headers.accept = NEEDED;
    const raw = req.rawHeaders ?? [];
    let patched = false;
    for (let i = 0; i < raw.length; i += 2) {
      if (raw[i]?.toLowerCase() === "accept") {
        raw[i + 1] = NEEDED;
        patched = true;
      }
    }
    if (!patched) raw.push("accept", NEEDED);
  }

  // Stateless: one MCP server + transport per request, tools bound to this tenant.
  const server = new McpServer({ name: "mytrakr-coach", version: "0.1.0" });
  registerTools(server, tenantId);
  // enableJsonResponse: plain JSON instead of an SSE frame. Simple HTTP clients
  // can parse the reply directly; compliant clients handle either.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  // Vercel already parses JSON bodies into req.body.
  await transport.handleRequest(req, res, req.body);
}
