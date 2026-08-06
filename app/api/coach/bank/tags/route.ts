// Retag one library item from the panel. The AI classifies on generation, but a
// coach needs the last word — and items generated before tags existed have none
// at all, so this is also the backfill path.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveStaffId, setBankTags } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";

export async function POST(req: Request) {
  const key = (await cookies()).get(COACH_COOKIE)?.value;
  const staff = key ? await resolveStaffId(key) : null;
  // The bank is a coach surface; other roles read athletes, not the library.
  if (!staff || staff.role !== "coach") {
    return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as { id?: unknown; tags?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : null;
  // An empty array is a legitimate intent — clearing every tag off an item.
  const tags = Array.isArray(body?.tags) ? body.tags.filter((t) => typeof t === "string").slice(0, 20) : null;
  if (!id || !tags) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });

  const ok = await setBankTags(staff.agencyId, id, tags as string[]);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
