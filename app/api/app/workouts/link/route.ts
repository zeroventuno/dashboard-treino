// Detach an imported activity from a session, or move it to another one, from
// the athlete's own dashboard. Same cookie auth as the move route, so an athlete
// can only ever touch their own workouts — and RLS refuses the rest even if an
// id leaked.
//
// This exists because automatic matching cannot be right every time: a commute
// or a walk lands on whatever was planned for that sport that day. The AI can
// already fix it through relink_activity, but a correction that requires
// phrasing a request to a chatbot is not a correction most people will make.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { unlinkActivity, relinkActivity } from "@/lib/product-db";
import { resolveTenantId } from "@/lib/data-product";
import { APP_COOKIE } from "@/app/api/app-login/route";

export async function POST(req: Request) {
  const key = (await cookies()).get(APP_COOKIE)?.value;
  const tenantId = key ? await resolveTenantId(key) : null;
  if (!tenantId) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { action?: unknown; id?: unknown; toId?: unknown; title?: unknown }
    | null;
  const action = body?.action === "unlink" || body?.action === "relink" ? body.action : null;
  const id = typeof body?.id === "string" ? body.id : null;
  if (!action || !id) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });

  let result;
  if (action === "unlink") {
    // The title is the UI's to choose because it is the only layer that knows
    // the athlete's language; the original Strava name is long gone by then
    // (the coach's title deliberately wins at import).
    const title = typeof body?.title === "string" ? body.title.slice(0, 120) : "";
    result = await unlinkActivity(tenantId, id, title);
  } else {
    const toId = typeof body?.toId === "string" ? body.toId : null;
    if (!toId) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
    result = await relinkActivity(tenantId, id, toId);
  }

  if (result.ok) return NextResponse.json({ ok: true });

  // not_found also covers "belongs to another tenant" — RLS returned no row, and
  // saying so would confirm the id exists.
  const status =
    result.code === "not_found" ? 404 : result.code === "no_db" ? 503 : 409;
  return NextResponse.json({ ok: false, code: result.code }, { status });
}
