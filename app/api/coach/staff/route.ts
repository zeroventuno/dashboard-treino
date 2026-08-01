// Add a professional to the agency (Settings → Equipe). Coach-authed via the
// coach cookie; createStaff is agency-scoped. Returns the generated trakc_ key
// ONCE — the UI shows it and it's never retrievable again (only its hash is stored).
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { resolveStaffId, createStaff } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";

const ROLES = ["coach", "nutritionist", "physio"];

export async function POST(req: NextRequest) {
  const key = (await cookies()).get(COACH_COOKIE)?.value;
  const staff = key ? await resolveStaffId(key) : null;
  // Only a coach can manage the agency's team.
  if (!staff || staff.role !== "coach") {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { name?: string; email?: string; role?: string };
  const role = String(body.role ?? "");
  if (!ROLES.includes(role)) {
    return NextResponse.json({ ok: false, code: "bad_role" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 200) : "";

  const created = await createStaff(staff.agencyId, { name, email, role });
  // The plaintext key travels back exactly once, over the authenticated response.
  return NextResponse.json({ ok: true, id: created.id, key: created.key });
}
