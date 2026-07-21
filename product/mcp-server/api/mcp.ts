// Vercel serverless entry for the TRAK coach MCP server.
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

  // Stateless: one MCP server + transport per request, tools bound to this tenant.
  const server = new McpServer({ name: "trak-coach", version: "0.1.0" });
  registerTools(server, tenantId);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  // Vercel already parses JSON bodies into req.body.
  await transport.handleRequest(req, res, req.body);
}
