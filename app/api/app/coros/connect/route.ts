// Start the COROS authorisation.
//
// Unlike Strava there is no app registered with COROS ahead of time: the
// client registers ITSELF with the athlete's regional cluster (RFC 7591) and
// goes straight to authorise. So this route does three things in order —
// register, remember, redirect — and the callback finishes the job.
//
// What has to survive the round trip (the PKCE verifier, the client_id COROS
// just issued, which cluster) rides in one short-lived httpOnly cookie, the
// same way Strava's `state` does. The tenant is NEVER taken from the URL.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { resolveTenantId } from "@/lib/data-product";
import { deviceLinkMetaReady, getTenantAgencyId } from "@/lib/product-db";
import { APP_COOKIE } from "@/app/api/app-login/route";
import {
  DEFAULT_REGION, authorizeUrl, corosCallbackUrl, corosOrigin, isCorosRegion, newPkce, registerClient,
} from "@/lib/coros";

export const COROS_OAUTH_COOKIE = "trak_coros_oauth";

export async function GET(req: Request) {
  const key = (await cookies()).get(APP_COOKIE)?.value;
  const tenantId = key ? await resolveTenantId(key) : null;
  if (!tenantId) return NextResponse.redirect(new URL("/app/login", req.url));

  const url = new URL(req.url);
  const asked = url.searchParams.get("region");
  const region = isCorosRegion(asked) ? asked : DEFAULT_REGION;

  // A registered redirect_uri is exact-match, and the cookie below is host-
  // scoped: starting from an alias would fail twice. Same self-healing bounce
  // the Strava route does.
  const canonical = corosOrigin(req);
  if (url.origin !== canonical) {
    return NextResponse.redirect(`${canonical}/api/app/coros/connect?region=${region}`);
  }

  // Cleared for an athlete's OWN data only. An athlete under an agency has a
  // coach reading the same calendar, and COROS's published terms speak to
  // "each user authorises their own data" — not to a coach panel. That is a
  // question for COROS in writing, not for this code to decide by reading
  // between lines. See the data-source note in the project memory.
  if (await getTenantAgencyId(tenantId)) {
    return NextResponse.redirect(new URL("/app?coros=agency_blocked", req.url));
  }
  if (!(await deviceLinkMetaReady())) {
    return NextResponse.redirect(new URL("/app?coros=needs_migration", req.url));
  }

  let target: string;
  const state = randomBytes(16).toString("hex");
  const { verifier, challenge } = newPkce();
  let clientId: string;
  try {
    const redirectUri = corosCallbackUrl(req);
    clientId = await registerClient(region, redirectUri);
    target = await authorizeUrl(region, { clientId, redirectUri, state, challenge });
  } catch (err) {
    console.error("[coros] could not start authorisation:", err instanceof Error ? err.message : err);
    return NextResponse.redirect(new URL("/app?coros=failed", req.url));
  }

  const res = NextResponse.redirect(target);
  res.cookies.set(
    COROS_OAUTH_COOKIE,
    Buffer.from(JSON.stringify({ state, verifier, clientId, region })).toString("base64url"),
    {
      httpOnly: true,
      sameSite: "lax", // must survive the redirect back from coros.com
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    },
  );
  return res;
}
