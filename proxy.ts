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
// Paths that are public but must match EXACTLY. "/" can't go in the prefix list
// below — every path starts with it, so it would open the whole site.
const PUBLIC_EXACT = new Set(["/"]);

const PUBLIC = [
  "/login", "/api/login", "/api/health",
  // /api/app/* (the athlete's own writes, e.g. rescheduling a session) reads the
  // same per-tenant cookie as /app — gating it behind the shared password would
  // lock every athlete out of their own dashboard.
  "/app", "/api/app-login", "/api/app/",
  // The coach panel has its own per-professional key auth (trakc_ in an httpOnly
  // cookie), same reasoning as /app — don't sit it behind the shared password.
  // /api/coach/* (bank generate/status) authenticate via the coach cookie too.
  "/coach", "/api/coach-login", "/api/coach/",
  // Provisioning is called by n8n before any account exists, so there is no
  // session to present — and the shared password is the wrong gate for it
  // anyway. It carries its own secret header, compared in constant time, and
  // stays closed when that env is unset. See app/api/provision/agency.
  "/api/provision/",
];

// The owner's personal dashboard used to sit at "/". It moved to "/me" so the
// domain's front door can be the product's, not one athlete's training data.
// Still behind the shared password — it just isn't the first thing the world
// sees when it types mytrakr.fit.

// Next 16 renamed the "middleware" convention to "proxy".
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_EXACT.has(pathname)) return NextResponse.next();
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
