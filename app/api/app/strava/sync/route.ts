// Pull recent activities into the athlete's calendar.
//
// Callable by the athlete ("sync now") and by a scheduler — n8n or a cron — with
// the same session-cookie auth, so there is one code path rather than a UI one
// and a background one that drift apart.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveTenantId } from "@/lib/data-product";
import {
  getDeviceLink, saveDeviceLink, markSync, importWorkouts,
  saveWorkoutZones, getIndicators,
} from "@/lib/product-db";
import { APP_COOKIE } from "@/app/api/app-login/route";
import {
  fetchActivities, fetchStreams, refreshTokens, toWorkout, streamsToZones, hasStrava,
} from "@/lib/strava";

/** How far back a sync reaches when the athlete has never synced. Deep enough
 * to give the fitness chart something to work with, shallow enough that a first
 * connect doesn't rewrite a year of a coach's carefully logged history. */
const FIRST_SYNC_DAYS = 45;
/** Overlap on later syncs: an activity edited or uploaded late would fall
 * through a window that started exactly at the last sync. */
const OVERLAP_DAYS = 3;
/** Stream calls one athlete may spend in a single sync.
 *
 * Strava's allowance — 100 requests per 15 minutes — belongs to the APPLICATION,
 * so it is shared by every athlete of every agency here. A first connect reaching
 * back 45 days could otherwise ask for forty streams in one go and starve
 * everyone else. Whatever is left over gets picked up by the next sync, which is
 * the right trade: a zone score arriving an hour late costs nothing, a 429
 * storm costs everybody. */
const MAX_STREAMS_PER_SYNC = 10;

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
    const { needsZones, ...result } = await importWorkouts(tenantId, items);

    // Time in zone, but only where it means something. `needsZones` is the set
    // of sessions that landed on a workout the coach actually structured — the
    // rest get no stream call, because there is no prescription to compare a
    // distribution against and the allowance is shared by every athlete here.
    //
    // Isolated in its own try/catch because it is an ENRICHMENT, and the import
    // above has already committed. Letting it throw meant a bad query in here
    // discarded the report of a sync that had genuinely worked: the sessions
    // were on the dashboard while the athlete was told the sync failed and the
    // next run had no last_sync_at to start from. A missing zone breakdown is a
    // detail; a successful import reported as a failure is a lie.
    let scored = 0;
    let warning: string | null = null;
    try {
      if (needsZones.length) {
        const indicators = await getIndicators(tenantId);
        const byId = new Map(items.map((i) => [i.external_id, i]));
        for (const externalId of needsZones.slice(0, MAX_STREAMS_PER_SYNC)) {
          const item = byId.get(externalId);
          if (!item) continue;
          const streams = await fetchStreams(token, externalId.replace("strava:", ""));
          const zones = streamsToZones(streams, indicators, item.discipline);
          if (zones) {
            await saveWorkoutZones(tenantId, externalId, zones);
            scored++;
          }
        }
      }
    } catch (err) {
      warning = err instanceof Error ? err.message.slice(0, 200) : "zone step failed";
      console.error("[strava] zone enrichment failed:", err);
    }

    await markSync(tenantId, "strava", null);
    return NextResponse.json({ ok: true, fetched: activities.length, scored, warning, ...result });
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
