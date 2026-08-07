// Put a library workout on athletes' calendars, in one batch.
//
// Coach-only (a nutritionist doesn't prescribe training) but NOT owner-only: a
// hired coach prescribing to their own roster is the everyday job. The roster
// check inside prescribeFromBank is what keeps that safe.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveStaffId, prescribeFromBank } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  const key = (await cookies()).get(COACH_COOKIE)?.value;
  const staff = key ? await resolveStaffId(key) : null;
  if (!staff || staff.role !== "coach") {
    return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { workoutId?: unknown; tenantIds?: unknown; date?: unknown }
    | null;

  const workoutId = typeof body?.workoutId === "string" && UUID.test(body.workoutId) ? body.workoutId : null;
  const date = typeof body?.date === "string" && ISO_DATE.test(body.date) ? body.date : null;
  // Validate the ids before the uuid[] cast: one malformed entry would abort the
  // whole statement and lose a legitimate batch.
  const tenantIds = Array.isArray(body?.tenantIds)
    ? (body.tenantIds as unknown[]).filter((v): v is string => typeof v === "string" && UUID.test(v)).slice(0, 300)
    : [];

  if (!workoutId || !date || tenantIds.length === 0) {
    return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  }

  const result = await prescribeFromBank(staff.id, staff.agencyId, workoutId, tenantIds, date);
  return NextResponse.json({ ok: true, ...result });
}
