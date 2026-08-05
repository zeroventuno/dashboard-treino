// Reschedule one session from the athlete's own dashboard (drag it to another
// day, or pick a date in the workout modal). Authenticates with the per-tenant
// account key in the httpOnly cookie — the same session /app itself uses — so an
// athlete can only ever move their own workouts.
//
// The write follows the model the coach briefing teaches the AI: the original
// stays marked `moved` and a planned copy lands on the new date, so the coach
// sees the change on the next get_workouts. See lib/product-db.ts:moveWorkout.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { moveWorkout } from "@/lib/product-db";
import { resolveTenantId } from "@/lib/data-product";
import { APP_COOKIE } from "@/app/api/app-login/route";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const key = (await cookies()).get(APP_COOKIE)?.value;
  const tenantId = key ? await resolveTenantId(key) : null;
  if (!tenantId) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { id?: unknown; date?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : null;
  const date = typeof body?.date === "string" ? body.date : null;
  if (!id || !date || !ISO_DATE.test(date)) {
    return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  }

  const result = await moveWorkout(tenantId, id, date);
  if (result.ok) return NextResponse.json({ ok: true });

  // not_found also covers "belongs to another tenant" — RLS returned no row, and
  // saying so would confirm the id exists.
  const status = result.code === "not_found" ? 404 : result.code === "no_db" ? 503 : 409;
  return NextResponse.json({ ok: false, code: result.code }, { status });
}
