// What COROS's MCP server offers THIS connection, argument by argument.
//
// The workout/plan tools' arguments are not published — COROS's own guidance is
// "follow the refreshed tool definitions your connected server returns". Writing
// a workout into an athlete's account from a guessed argument shape would
// create wrong sessions that only the COROS app can delete, so the shape is
// read from the live server first. This route is that read.
//
// Read-only and tool METADATA only: names, descriptions and JSON Schemas — the
// same list any connected client sees. It touches no activity data and creates
// nothing. Session-authenticated, so it is the athlete's own connection used
// by the athlete.
//
//   GET /api/app/coros/tools            → every tool, name + description
//   GET /api/app/coros/tools?match=work → full input schema of tools whose name
//                                          contains "work" (case-insensitive)
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveTenantId } from "@/lib/data-product";
import { APP_COOKIE } from "@/app/api/app-login/route";
import { CorosError } from "@/lib/coros";
import { openCorosLink } from "@/lib/coros-link";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const key = (await cookies()).get(APP_COOKIE)?.value;
  const tenantId = key ? await resolveTenantId(key) : null;
  if (!tenantId) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401, headers: NO_STORE });

  const opened = await openCorosLink(tenantId);
  if ("refusal" in opened) {
    return NextResponse.json({ ok: false, code: opened.refusal.code }, { status: opened.refusal.status, headers: NO_STORE });
  }

  const params = new URL(req.url).searchParams;
  const match = (params.get("match") ?? "").trim().toLowerCase().slice(0, 40);
  // A browser's JSON viewer collapses nested objects into "{…}", which is a
  // schema you cannot copy. `raw=1` answers as plain pretty-printed text.
  const raw = params.get("raw") === "1";

  try {
    const tools = await opened.link.use((s) => s.listTools());
    const shown = tools.map((t) =>
      match && t.name.toLowerCase().includes(match)
        ? { name: t.name, description: t.description ?? null, inputSchema: t.inputSchema ?? null }
        : { name: t.name, description: (t.description ?? "").slice(0, 160) },
    );
    const body = { ok: true, region: opened.link.region, count: tools.length, tools: shown };
    if (raw) {
      return new Response(JSON.stringify(body, null, 2), {
        headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE },
      });
    }
    return NextResponse.json(body, { headers: NO_STORE });
  } catch (err) {
    const reconnect = err instanceof CorosError && err.kind === "unauthorized";
    // The message is ours (kind + HTTP status), never a token or a body.
    const message = err instanceof Error ? err.message.slice(0, 200) : "unknown";
    console.error("[coros] tools probe failed:", message);
    return NextResponse.json(
      { ok: false, code: reconnect ? "needs_reconnect" : "probe_failed", error: message },
      { status: reconnect ? 409 : 502, headers: NO_STORE },
    );
  }
}
