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
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }

  // Auth: Bearer <account API key> → tenant_id.
  const auth = req.headers["authorization"];
  const key = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : null;
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
