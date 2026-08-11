// Move athletes between professionals' books. Owner-only: redistributing the
// agency's work is an ownership decision, and a hired coach handing their own
// athletes to someone else is a different thing entirely.
//
// The ids all come from the browser, so nothing here is trusted — reassignAthletes
// re-checks every staff id and every athlete against this agency inside the
// statement itself.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveStaffId, reassignAthletes, type Reassignment } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A whole-agency reshuffle is large; a request larger than this is a bug or an
 * attack, not an owner reorganising a team. */
const MAX_MOVES = 500;

export async function POST(req: Request) {
  const key = (await cookies()).get(COACH_COOKIE)?.value;
  const staff = key ? await resolveStaffId(key) : null;
  if (!staff) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  if (!staff.isOwner) return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as { moves?: unknown } | null;
  const raw = Array.isArray(body?.moves) ? body.moves : null;
  if (!raw || raw.length === 0 || raw.length > MAX_MOVES) {
    return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  }

  // Validate every id BEFORE touching the database: one malformed uuid reaching
  // a cast would abort the whole transaction, so the owner would lose a batch
  // they had already reviewed because of a single bad row.
  const moves: Reassignment[] = [];
  for (const m of raw) {
    const x = m as { tenantId?: unknown; fromStaffId?: unknown; toStaffId?: unknown };
    if (
      typeof x.tenantId !== "string" || !UUID.test(x.tenantId) ||
      typeof x.fromStaffId !== "string" || !UUID.test(x.fromStaffId) ||
      typeof x.toStaffId !== "string" || !UUID.test(x.toStaffId) ||
      x.fromStaffId === x.toStaffId
    ) {
      return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
    }
    moves.push({ tenantId: x.tenantId, fromStaffId: x.fromStaffId, toStaffId: x.toStaffId });
  }

  const result = await reassignAthletes(staff.agencyId, moves);
  // `moved` can be lower than what was asked: rows that don't belong to this
  // agency are skipped rather than failing the batch. Reporting the real number
  // lets the UI say so instead of implying everything landed.
  return NextResponse.json({ ok: true, moved: result.moved, asked: moves.length });
}
