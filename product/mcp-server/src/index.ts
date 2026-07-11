import { createServer, type IncomingMessage } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { resolveTenant } from "./auth.js";
import { registerTools } from "./tools.js";

const PORT = Number(process.env.PORT ?? 8787);

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const httpServer = createServer(async (req, res) => {
  if (req.method !== "POST" || !req.url?.startsWith("/mcp")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }

  // Auth: account API key from Authorization header (Bearer) OR ?key= query.
  const auth = req.headers["authorization"];
  const headerKey = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const queryKey = new URL(req.url ?? "", "http://localhost").searchParams.get("key");
  const key = headerKey ?? queryKey;
  const tenantId = key ? await resolveTenant(key) : null;
  if (!tenantId) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid or missing account key" }));
    return;
  }

  const raw = await readBody(req);
  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : undefined;
  } catch {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid json" }));
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
  await transport.handleRequest(req, res, body);
});

httpServer.listen(PORT, () => {
  console.log(`TRAK coach MCP listening on :${PORT}/mcp`);
});
