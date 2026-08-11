// Preview and apply a multi-week plan block across a cohort.
//
// Two steps on purpose, and the split is the feature. A template built for eight
// hours applied to an athlete with five has to lose something, and the coach is
// the one who should decide what — so the preview shows where every session
// lands for every athlete, and what didn't fit, before anything reaches a
// calendar.
//
// Apply then writes the previews it is HANDED rather than recomputing them, so
// what lands is exactly what was approved. Recomputing would be subtly worse:
// an athlete editing their availability between the two clicks would silently
// get a different week from the one the coach signed off on.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveStaffId, previewPlanBlock, applyPlanBlock, type BlockPreview } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";

export async function POST(req: Request) {
  const key = (await cookies()).get(COACH_COOKIE)?.value;
  const staff = key ? await resolveStaffId(key) : null;
  if (!staff) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { action: "preview"; blockId: string; tenantIds: string[]; startISO: string }
    | { action: "apply"; previews: BlockPreview[] }
    | null;
  if (!body) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });

  try {
    if (body.action === "preview") {
      // The roster boundary is enforced inside previewPlanBlock, not here: a
      // tenant id in the payload is a request, never a permission.
      const previews = await previewPlanBlock(
        staff.id,
        staff.agencyId,
        body.blockId,
        body.tenantIds,
        body.startISO,
      );
      return NextResponse.json({ ok: true, previews });
    }

    if (body.action === "apply") {
      const result = await applyPlanBlock(staff.id, body.previews);
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 200) : "unknown";
    console.error("[coach] plan block failed:", err);
    return NextResponse.json({ ok: false, code: "failed", error: message }, { status: 500 });
  }
}
