// Bulk cleanup of the workout bank: archive (reversible, keeps the row) or
// delete (permanent). A generation run can produce dozens of items at once, so
// undoing a bad batch one card at a time isn't realistic — but deletion is
// irreversible, which is why the panel asks the coach to confirm it explicitly
// and offers archiving right beside it.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveStaffId, bulkBankAction } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const key = (await cookies()).get(COACH_COOKIE)?.value;
  const staff = key ? await resolveStaffId(key) : null;
  if (!staff || staff.role !== "coach") {
    return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { ids?: unknown; action?: unknown } | null;
  const action = body?.action === "delete" || body?.action === "archive" ? body.action : null;
  // Validate the ids here: a malformed one would abort the whole statement at
  // the uuid[] cast, losing a legitimate bulk action to one bad entry.
  const ids = Array.isArray(body?.ids)
    ? (body.ids as unknown[]).filter((v): v is string => typeof v === "string" && UUID.test(v)).slice(0, 500)
    : [];
  if (!action || ids.length === 0) {
    return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  }

  const affected = await bulkBankAction(staff.agencyId, ids, action);
  return NextResponse.json({ ok: true, affected });
}
