// Per-professional auth for the coach panel (/coach), separate from the athlete
// key. The professional key (trakc_…) IS the credential, stored in an httpOnly
// cookie so JS can't read it and revoking the key kills the session. Mirrors
// /api/app-login, but resolves a staff member instead of a tenant.
import { NextResponse, type NextRequest } from "next/server";
import { resolveStaffId } from "@/lib/product-db";

export const COACH_COOKIE = "trak_coach";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function withKeyCookie(res: NextResponse, key: string): NextResponse {
  res.cookies.set(COACH_COOKIE, key, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return res;
}

/** Magic link: /api/coach-login?key=trakc_… → logs in and lands on a clean /coach. */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") ?? "";

  let staff: Awaited<ReturnType<typeof resolveStaffId>> = null;
  try {
    staff = key ? await resolveStaffId(key) : null;
  } catch (err) {
    console.error("[coach-login] staff lookup failed:", err);
    return NextResponse.redirect(new URL("/coach/login?erro=unavailable", req.url));
  }

  if (!staff) return NextResponse.redirect(new URL("/coach/login?erro=not_found", req.url));
  return withKeyCookie(NextResponse.redirect(new URL("/coach", req.url)), key);
}

/** Form login from /coach/login. */
export async function POST(req: NextRequest) {
  const { key } = await req.json().catch(() => ({ key: "" }));
  if (typeof key !== "string" || !key) {
    return NextResponse.json({ ok: false, code: "not_found" }, { status: 401 });
  }

  // Distinguish an unreachable database (503) from a genuinely bad key (401) —
  // blaming the key when the server is down sends people chasing a non-problem.
  let staff: Awaited<ReturnType<typeof resolveStaffId>>;
  try {
    staff = await resolveStaffId(key);
  } catch (err) {
    console.error("[coach-login] staff lookup failed:", err);
    return NextResponse.json({ ok: false, code: "unavailable" }, { status: 503 });
  }

  if (!staff) return NextResponse.json({ ok: false, code: "not_found" }, { status: 401 });
  return withKeyCookie(NextResponse.json({ ok: true }), key);
}

/** Logout. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(COACH_COOKIE);
  return res;
}
