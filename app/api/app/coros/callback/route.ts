// COROS sends the athlete back here with a code. Exchange it for tokens, keep
// them against THIS tenant, and bounce to the dashboard.
//
// The tenant comes from the session cookie, never from anything COROS echoes
// back — a redirect is visible and craftable, a cookie is not.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveTenantId } from "@/lib/data-product";
import { getTenantAgencyId, saveDeviceLink, saveDeviceLinkMeta } from "@/lib/product-db";
import { APP_COOKIE } from "@/app/api/app-login/route";
import { corosCallbackUrl, exchangeCode, isCorosRegion } from "@/lib/coros";
import { COROS_OAUTH_COOKIE } from "../connect/route";

interface Pending { state: string; verifier: string; clientId: string; region: string }

function readPending(raw: string | undefined): Pending | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<Pending>;
    if (typeof j.state === "string" && typeof j.verifier === "string" &&
        typeof j.clientId === "string" && typeof j.region === "string") return j as Pending;
  } catch { /* fall through */ }
  return null;
}

export async function GET(req: Request) {
  const jar = await cookies();
  const key = jar.get(APP_COOKIE)?.value;
  const tenantId = key ? await resolveTenantId(key) : null;
  if (!tenantId) return NextResponse.redirect(new URL("/app/login", req.url));

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const pending = readPending(jar.get(COROS_OAUTH_COOKIE)?.value);

  // Declining on COROS's screen is a "no", not an error.
  if (url.searchParams.get("error") || !code) {
    return NextResponse.redirect(new URL("/app?coros=cancelled", req.url));
  }
  if (!state || !pending || state !== pending.state || !isCorosRegion(pending.region)) {
    return NextResponse.redirect(new URL("/app?coros=bad_state", req.url));
  }

  // Re-checked here as well as at connect: the athlete could have been moved
  // under an agency between the two.
  if (await getTenantAgencyId(tenantId)) {
    return NextResponse.redirect(new URL("/app?coros=agency_blocked", req.url));
  }

  try {
    const tokens = await exchangeCode(pending.region, {
      clientId: pending.clientId,
      code,
      redirectUri: corosCallbackUrl(req),
      verifier: pending.verifier,
    });
    await saveDeviceLink(tenantId, "coros", {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_at,
      scope: tokens.scope,
    });
    await saveDeviceLinkMeta(tenantId, "coros", { region: pending.region, client_id: pending.clientId });
  } catch (err) {
    console.error("[coros] code exchange failed:", err instanceof Error ? err.message : err);
    return NextResponse.redirect(new URL("/app?coros=failed", req.url));
  }

  const res = NextResponse.redirect(new URL("/app?coros=connected", req.url));
  res.cookies.delete(COROS_OAUTH_COOKIE);
  return res;
}
