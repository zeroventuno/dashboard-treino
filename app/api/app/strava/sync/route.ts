// Pull recent activities into the athlete's calendar.
//
// Callable by the athlete ("sync now") and by a scheduler — n8n or a cron — with
// the same session-cookie auth, so there is one code path rather than a UI one
// and a background one that drift apart.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveTenantId } from "@/lib/data-product";
import { getDeviceLink, saveDeviceLink, markSync, importWorkouts } from "@/lib/product-db";
import { APP_COOKIE } from "@/app/api/app-login/route";
import { fetchActivities, refreshTokens, toWorkout, hasStrava } from "@/lib/strava";

/** How far back a sync reaches when the athlete has never synced. Deep enough
 * to give the fitness chart something to work with, shallow enough that a first
 * connect doesn't rewrite a year of a coach's carefully logged history. */
const FIRST_SYNC_DAYS = 45;
/** Overlap on later syncs: an activity edited or uploaded late would fall
 * through a window that started exactly at the last sync. */
const OVERLAP_DAYS = 3;

export async function POST() {
  const key = (await cookies()).get(APP_COOKIE)?.value;
  const tenantId = key ? await resolveTenantId(key) : null;
  if (!tenantId) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  if (!hasStrava()) return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });

  const link = await getDeviceLink(tenantId, "strava");
  if (!link) return NextResponse.json({ ok: false, code: "not_connected" }, { status: 404 });

  try {
    let token = link.access_token;
    // Strava's tokens last six hours, so a refresh is the normal path, not an
    // edge case. Persist the new pair or the next sync repeats the dance.
    const expiresAt = link.expires_at ? Date.parse(link.expires_at) : 0;
    if (link.refresh_token && expiresAt - Date.now() < 5 * 60_000) {
      const t = await refreshTokens(link.refresh_token);
      token = t.access_token;
      await saveDeviceLink(tenantId, "strava", {
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        expires_at: t.expires_at,
      });
    }

    const sinceDays = link.last_sync_at ? OVERLAP_DAYS : FIRST_SYNC_DAYS;
    const after = Math.floor((Date.now() - sinceDays * 86_400_000) / 1000);

    const activities = await fetchActivities(token, after);
    const items = activities.map(toWorkout).filter((w): w is NonNullable<typeof w> => w !== null);
    const result = await importWorkouts(tenantId, items);

    await markSync(tenantId, "strava", null);
    return NextResponse.json({ ok: true, fetched: activities.length, ...result });
  } catch (err) {
    // Stored, not just logged: a sync that keeps failing has to be visible on
    // the dashboard, or the athlete just sees their sessions quietly stop
    // arriving and assumes the feature works.
    const message = err instanceof Error ? err.message.slice(0, 200) : "unknown";
    console.error("[strava] sync failed:", err);
    await markSync(tenantId, "strava", message);
    return NextResponse.json({ ok: false, code: "sync_failed", error: message }, { status: 502 });
  }
}
