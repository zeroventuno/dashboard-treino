// Pull recent COROS activities into the athlete's calendar.
//
// Same contract as the Strava sync: callable by the athlete ("sync now") and,
// later, by a scheduler with the same session cookie, so there is one code
// path. Everything that lands goes through importWorkouts, which already
// knows how to claim a planned session instead of duplicating it.
//
// COROS gives no webhook on the self-service track, so this is pull-only.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveTenantId } from "@/lib/data-product";
import {
  getDeviceLink, getDeviceLinkMeta, getTenantAgencyId, importWorkouts, markSync, saveDeviceLink,
} from "@/lib/product-db";
import { APP_COOKIE } from "@/app/api/app-login/route";
import {
  CorosError, CorosSession, buildRecordQuery, dayRange, findRecords, isCorosRegion, mapRecords, refreshTokens,
  type CorosRegion,
} from "@/lib/coros";

/** Reach for a first connect: deep enough to give the fitness chart something
 * to work with, shallow enough not to rewrite a year of logged history. */
const FIRST_SYNC_DAYS = 45;
/** Overlap on later syncs: an activity edited or uploaded late would fall
 * through a window that started exactly at the last sync. */
const OVERLAP_DAYS = 3;

const RECORDS_TOOL = "querySportRecords";

export async function POST() {
  const key = (await cookies()).get(APP_COOKIE)?.value;
  const tenantId = key ? await resolveTenantId(key) : null;
  if (!tenantId) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });

  // A sync running after the athlete was placed under an agency would put
  // COROS-sourced sessions in front of a coach. Refused, same as at connect.
  if (await getTenantAgencyId(tenantId)) {
    return NextResponse.json({ ok: false, code: "agency_blocked" }, { status: 409 });
  }

  const link = await getDeviceLink(tenantId, "coros");
  if (!link) return NextResponse.json({ ok: false, code: "not_connected" }, { status: 404 });

  const meta = await getDeviceLinkMeta(tenantId, "coros");
  const region = meta?.region;
  const clientId = meta?.client_id;
  if (!isCorosRegion(region) || typeof clientId !== "string") {
    await markSync(tenantId, "coros", "connection details missing — reconnect");
    return NextResponse.json({ ok: false, code: "needs_reconnect" }, { status: 409 });
  }

  let token = link.access_token;
  let refreshToken = link.refresh_token;

  /** Swap the refresh token for a fresh access token and persist the pair. */
  const refresh = async (): Promise<void> => {
    if (!refreshToken) throw new CorosError("no refresh token — reconnect", "unauthorized", 401);
    const t = await refreshTokens(region as CorosRegion, { clientId, refreshToken });
    token = t.access_token;
    refreshToken = t.refresh_token ?? refreshToken;
    await saveDeviceLink(tenantId, "coros", {
      access_token: token,
      refresh_token: refreshToken,
      expires_at: t.expires_at,
      scope: t.scope,
    });
  };

  try {
    // "Unless we are confident it is still valid" — an unreadable expiry
    // refreshes, rather than skipping and 401-ing hours later (the Strava bug).
    const expiresMs = link.expires_at != null ? Number(link.expires_at) * 1000 : NaN;
    if (!(expiresMs - Date.now() > 5 * 60_000)) await refresh();

    const sinceDays = link.last_sync_at ? OVERLAP_DAYS : FIRST_SYNC_DAYS;

    const run = async () => {
      const session = new CorosSession(region, token);
      await session.init();

      // The schema is read live: COROS's own guidance is not to assume tool
      // arguments, and regions may run different versions.
      const tools = await session.listTools();
      const tool = tools.find((t) => t.name === RECORDS_TOOL);
      if (!tool) {
        throw new CorosError(
          `${RECORDS_TOOL} is not offered (tools: ${tools.map((t) => t.name).slice(0, 12).join(", ") || "none"})`,
          "schema",
        );
      }
      const args = buildRecordQuery(tool, dayRange(sinceDays));
      return session.callTool(RECORDS_TOOL, args);
    };

    let payload: unknown;
    try {
      payload = await run();
    } catch (err) {
      // One retry behind a refresh: expiry is a prediction, the rejection is
      // the authoritative answer.
      if (!(err instanceof CorosError) || err.kind !== "unauthorized") throw err;
      await refresh();
      payload = await run();
    }

    const records = findRecords(payload);
    const mapped = mapRecords(records);

    // Records arrived but none could be read: a shape this code doesn't know.
    // Said by NAME — the athlete's values stay out of the message.
    const unreadable = mapped.skipped.no_id + mapped.skipped.no_date + mapped.skipped.no_duration;
    if (records.length > 0 && mapped.items.length === 0 && unreadable > 0) {
      throw new CorosError(
        `COROS returned ${records.length} record(s) this app could not read ` +
          `(no id: ${mapped.skipped.no_id}, no date: ${mapped.skipped.no_date}, no duration: ${mapped.skipped.no_duration}); ` +
          `fields: ${mapped.sampleKeys.join(", ")}`,
        "schema",
      );
    }

    const { needsZones: _needsZones, ...result } = await importWorkouts(tenantId, mapped.items);
    await markSync(tenantId, "coros", null);
    return NextResponse.json({ ok: true, fetched: records.length, skipped: mapped.skipped, ...result });
  } catch (err) {
    // Stored, not just logged: a sync that keeps failing has to be visible on
    // the dashboard, or sessions quietly stop arriving and the athlete assumes
    // the feature works.
    const message = err instanceof Error ? err.message.slice(0, 280) : "unknown";
    console.error("[coros] sync failed:", message);
    await markSync(tenantId, "coros", message);
    const reconnect = err instanceof CorosError && err.kind === "unauthorized";
    return NextResponse.json(
      { ok: false, code: reconnect ? "needs_reconnect" : "sync_failed", error: message },
      { status: reconnect ? 409 : 502 },
    );
  }
}
