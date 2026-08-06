// Save the coach's methodology from the panel. Same jsonb the set_methodology
// MCP tool writes, and the same shallow merge — a field left out is kept, so the
// two paths (typing here, dictating to the copilot) don't overwrite each other.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveStaffId, saveMethodology, type Methodology } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";

const FIELDS = ["philosophy", "periodization", "intensity_distribution", "defaults", "notes"] as const;

export async function POST(req: Request) {
  const key = (await cookies()).get(COACH_COOKIE)?.value;
  const staff = key ? await resolveStaffId(key) : null;
  if (!staff) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });

  const patch: Methodology = {};
  for (const f of FIELDS) {
    if (typeof body[f] === "string") patch[f] = (body[f] as string).slice(0, 4000);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  }

  const ok = await saveMethodology(staff.id, patch);
  return NextResponse.json({ ok }, { status: ok ? 200 : 500 });
}
