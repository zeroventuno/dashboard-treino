// Start the Strava authorisation. Sends the athlete to Strava with a one-time
// state that we also drop in an httpOnly cookie — the callback refuses anything
// whose state doesn't match, so a link someone else crafted can't attach their
// Strava account to this athlete's dashboard.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { resolveTenantId } from "@/lib/data-product";
import { APP_COOKIE } from "@/app/api/app-login/route";
import { authorizeUrl, hasStrava } from "@/lib/strava";

export const STRAVA_STATE_COOKIE = "trak_strava_state";

/** Strava requires the redirect to match the app's registered callback domain
 * exactly, so it is derived from the incoming request rather than guessed. */
export function callbackUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.origin}/api/app/strava/callback`;
}

export async function GET(req: Request) {
  const key = (await cookies()).get(APP_COOKIE)?.value;
  const tenantId = key ? await resolveTenantId(key) : null;
  if (!tenantId) return NextResponse.redirect(new URL("/app/login", req.url));
  if (!hasStrava()) {
    return NextResponse.redirect(new URL("/app?device=not_configured", req.url));
  }

  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authorizeUrl(callbackUrl(req), state));
  res.cookies.set(STRAVA_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax", // must survive the redirect back from strava.com
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
