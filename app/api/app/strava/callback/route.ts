// Strava sends the athlete back here with a code. Exchange it for tokens, store
// them against THIS tenant, and bounce to the dashboard.
//
// The tenant comes from the session cookie, never from the URL: the code and
// state are visible in a redirect, so binding on anything Strava echoes back
// would let a crafted link attach an account to the wrong athlete.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveTenantId } from "@/lib/data-product";
import { saveDeviceLink } from "@/lib/product-db";
import { APP_COOKIE } from "@/app/api/app-login/route";
import { exchangeCode, hasStrava } from "@/lib/strava";
import { STRAVA_STATE_COOKIE } from "../connect/route";

export async function GET(req: Request) {
  const jar = await cookies();
  const key = jar.get(APP_COOKIE)?.value;
  const tenantId = key ? await resolveTenantId(key) : null;
  if (!tenantId || !hasStrava()) return NextResponse.redirect(new URL("/app/login", req.url));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = jar.get(STRAVA_STATE_COOKIE)?.value;

  // The athlete can also just decline on Strava's screen — that's not an error
  // worth shouting about, it's a "no".
  if (url.searchParams.get("error") || !code) {
    return NextResponse.redirect(new URL("/app?device=cancelled", req.url));
  }
  if (!state || !expected || state !== expected) {
    return NextResponse.redirect(new URL("/app?device=bad_state", req.url));
  }

  try {
    const tokens = await exchangeCode(code);
    await saveDeviceLink(tenantId, "strava", {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_at,
      external_id: tokens.athlete_id ?? null,
      scope: tokens.scope ?? null,
    });
  } catch (err) {
    console.error("[strava] code exchange failed:", err);
    return NextResponse.redirect(new URL("/app?device=failed", req.url));
  }

  const res = NextResponse.redirect(new URL("/app?device=connected", req.url));
  res.cookies.delete(STRAVA_STATE_COOKIE);
  return res;
}
