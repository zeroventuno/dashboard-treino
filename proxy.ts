import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, tokenFor } from "@/lib/auth";

// Paths the shared dashboard password does NOT gate.
//  • /login, /api/login → the personal dashboard's own login.
//  • /app, /api/app-login → the multi-tenant product dashboard. It has per-tenant
//    auth of its own (account key in an httpOnly cookie), so gating it behind the
//    single shared password would be both redundant and wrong: each athlete signs
//    in with their own key, and the login redirect would eat the ?key= magic link.
// /api/health is public on purpose: it's what you reach for when logging in is
// the thing that's broken, so it can't sit behind the login. It exposes only
// up/down + an error code.
const PUBLIC = ["/login", "/api/login", "/app", "/api/app-login", "/api/health"];

// Next 16 renamed the "middleware" convention to "proxy".
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const password = process.env.DASHBOARD_PASSWORD;
  // No password configured → open (local dev / preview convenience).
  if (!password) return NextResponse.next();

  const expected = await tokenFor(password);
  const cookie = req.cookies.get(AUTH_COOKIE)?.value;

  if (cookie === expected) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
