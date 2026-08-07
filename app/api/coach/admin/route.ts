// Owner-only administration: who owns the agency, what each professional
// programs, who looks after which athlete, and what an athlete is worth monthly.
//
// All of it is gated on `isOwner` rather than on the coach role. A coach runs
// their own roster; deciding another professional's book — or seeing what the
// agency charges — is an ownership decision, and a nutritionist who owns the
// place should be able to do it while a hired coach should not.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveStaffId, updateStaff, updateAgencyAthlete, createAthlete } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SPORTS = ["swim", "bike", "run", "strength"];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const str = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

export async function POST(req: Request) {
  const key = (await cookies()).get(COACH_COOKIE)?.value;
  const staff = key ? await resolveStaffId(key) : null;
  if (!staff) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  if (!staff.isOwner) return NextResponse.json({ ok: false, code: "not_owner" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });

  // Creating an athlete is the one action with no `id` yet — it mints one.
  if (body.kind === "newAthlete") {
    const name = str(body.name);
    const email = str(body.email, 160)?.toLowerCase();
    if (!name || !email || !EMAIL.test(email)) {
      return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
    }
    const res = await createAthlete(staff.agencyId, {
      name,
      email,
      nickname: str(body.nickname, 60),
      phone: str(body.phone, 40),
    });
    // The key travels back exactly once — it is not stored in plaintext, so a
    // reload can never show it again.
    return NextResponse.json(res, { status: res.ok ? 200 : res.code === "duplicate_email" ? 409 : 503 });
  }

  const target = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  if (!target) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });

  if (body.kind === "staff") {
    const patch: { isOwner?: boolean; sports?: string[] } = {};
    if (typeof body.isOwner === "boolean") patch.isOwner = body.isOwner;
    if (Array.isArray(body.sports)) patch.sports = body.sports.filter((s) => SPORTS.includes(String(s)));
    const res = await updateStaff(staff.agencyId, target, patch);
    // Removing the last owner would lock the agency out of its own admin.
    return NextResponse.json(res, { status: res.ok ? 200 : res.code === "last_owner" ? 409 : 404 });
  }

  if (body.kind === "athlete") {
    const patch: {
      monthlyValue?: number | null; staffIds?: string[]; name?: string; nickname?: string; phone?: string;
    } = {};
    if ("monthlyValue" in body) {
      const v = body.monthlyValue;
      // "" clears the price; anything unparseable is rejected rather than
      // silently stored as 0, which would understate the book.
      if (v === null || v === "") patch.monthlyValue = null;
      else {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json({ ok: false, code: "bad_value" }, { status: 400 });
        }
        patch.monthlyValue = n;
      }
    }
    if (Array.isArray(body.staffIds)) {
      patch.staffIds = body.staffIds.filter((s): s is string => typeof s === "string" && UUID.test(s));
    }
    if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 120);
    // These two accept "" on purpose — that's how the owner clears them.
    if (typeof body.nickname === "string") patch.nickname = body.nickname.trim().slice(0, 60);
    if (typeof body.phone === "string") patch.phone = body.phone.trim().slice(0, 40);

    const ok = await updateAgencyAthlete(staff.agencyId, target, patch);
    return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
  }

  return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
}
