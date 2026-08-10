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

/**
 * The single origin Strava knows about.
 *
 * A Strava app registers ONE callback domain, but this deployment answers on
 * several hosts — mytrakr.fit, www, trakdash.vercel.app, and a fresh URL for
 * every preview build. Deriving the redirect from the incoming request meant
 * opening the dashboard through any of the others produced a redirect_uri
 * Strava rejects outright ("Bad Request … field: redirect_uri, code: invalid"),
 * with nothing in our own logs to explain it.
 *
 * Falls back to the request's origin so local development keeps working without
 * configuration.
 */
export function canonicalOrigin(req: Request): string {
  const configured = process.env.APP_ORIGIN?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  return new URL(req.url).origin;
}

export function callbackUrl(req: Request): string {
  return `${canonicalOrigin(req)}/api/app/strava/callback`;
}

export async function GET(req: Request) {
  const key = (await cookies()).get(APP_COOKIE)?.value;
  const tenantId = key ? await resolveTenantId(key) : null;
  if (!tenantId) return NextResponse.redirect(new URL("/app/login", req.url));
  if (!hasStrava()) {
    return NextResponse.redirect(new URL("/app?device=not_configured", req.url));
  }

  // Started from an alias. Sending them to Strava from here would fail on the
  // redirect_uri, and even if it didn't, the state cookie below would be set on
  // this host while the callback arrives on the canonical one — cookies don't
  // cross hosts, so it would fail a second time on the state check. Bounce to
  // the same route on the right origin instead; it self-heals, asking for a
  // login there only if they have no session yet.
  const canonical = canonicalOrigin(req);
  if (new URL(req.url).origin !== canonical) {
    return NextResponse.redirect(`${canonical}/api/app/strava/connect`);
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
