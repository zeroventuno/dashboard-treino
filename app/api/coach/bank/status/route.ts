// Validate / archive a library workout from the /coach/bank UI. Staff-authed
// (coach) via the coach cookie; the mutation is agency-scoped in setBankStatus.
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { resolveStaffId, setBankStatus } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";

const STATUSES = ["draft", "validated", "archived"] as const;
type Status = (typeof STATUSES)[number];

export async function POST(req: NextRequest) {
  const key = (await cookies()).get(COACH_COOKIE)?.value;
  const staff = key ? await resolveStaffId(key) : null;
  if (!staff || staff.role !== "coach") {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const { id, status } = (await req.json().catch(() => ({}))) as { id?: string; status?: string };
  if (typeof id !== "string" || !STATUSES.includes(status as Status)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const done = await setBankStatus(staff.agencyId, id, status as Status);
  return NextResponse.json({ ok: done });
}
