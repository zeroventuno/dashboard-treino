// One place that turns "this athlete" into "a live COROS session".
//
// Sync, the tool-schema probe and (next) sending a plan all need the same
// three things before they may talk to COROS: the athlete is not under an
// agency, a connection exists with its region + client id, and the access token
// is good. Each of those has a failure that must be reported the same way, and
// the token logic is subtle enough (an unreadable expiry must REFRESH, not
// skip — the Strava bug) that it should exist exactly once.
import {
  getDeviceLink, getDeviceLinkMeta, getTenantAgencyId, markSync, saveDeviceLink,
} from "@/lib/product-db";
import { CorosError, CorosSession, isCorosRegion, refreshTokens, type CorosRegion } from "@/lib/coros";

export type LinkRefusal = {
  code: "agency_blocked" | "not_connected" | "needs_reconnect";
  status: 409 | 404;
};

export interface CorosLink {
  region: CorosRegion;
  /** Last successful sync, for callers that choose a window from it. */
  lastSyncAt: string | null;
  /**
   * Runs `fn` against an initialised session. The access token is refreshed
   * first unless it is confidently valid, and once more behind a 401 — expiry
   * is a prediction, the rejection is the authoritative answer.
   */
  use<T>(fn: (session: CorosSession) => Promise<T>): Promise<T>;
}

/** Refresh when fewer than this many ms of validity are left. */
const SKEW_MS = 5 * 60_000;

export async function openCorosLink(tenantId: string): Promise<{ link: CorosLink } | { refusal: LinkRefusal }> {
  // COROS-sourced sessions must never reach a coach's screen: refused here,
  // for every caller, not just at connect time.
  if (await getTenantAgencyId(tenantId)) return { refusal: { code: "agency_blocked", status: 409 } };

  const row = await getDeviceLink(tenantId, "coros");
  if (!row) return { refusal: { code: "not_connected", status: 404 } };

  const meta = await getDeviceLinkMeta(tenantId, "coros");
  const region = meta?.region;
  const clientId = meta?.client_id;
  if (!isCorosRegion(region) || typeof clientId !== "string") {
    await markSync(tenantId, "coros", "connection details missing — reconnect");
    return { refusal: { code: "needs_reconnect", status: 409 } };
  }

  let token = row.access_token;
  let refreshToken = row.refresh_token;

  /** Swap the refresh token for a fresh access token and persist the pair. */
  const refresh = async (): Promise<void> => {
    if (!refreshToken) throw new CorosError("no refresh token — reconnect", "unauthorized", 401);
    const t = await refreshTokens(region, { clientId, refreshToken });
    token = t.access_token;
    refreshToken = t.refresh_token ?? refreshToken;
    await saveDeviceLink(tenantId, "coros", {
      access_token: token,
      refresh_token: refreshToken,
      expires_at: t.expires_at,
      scope: t.scope,
    });
  };

  let checked = false;
  const ensureFresh = async (): Promise<void> => {
    if (checked) return;
    checked = true;
    // "Unless we are confident it is still valid" — an unreadable expiry
    // refreshes, rather than skipping and 401-ing hours later.
    const expiresMs = row.expires_at != null ? Number(row.expires_at) * 1000 : NaN;
    if (!(expiresMs - Date.now() > SKEW_MS)) await refresh();
  };

  const link: CorosLink = {
    region,
    lastSyncAt: row.last_sync_at ?? null,
    async use(fn) {
      await ensureFresh();
      const attempt = async () => {
        const session = new CorosSession(region, token);
        await session.init();
        return fn(session);
      };
      try {
        return await attempt();
      } catch (err) {
        if (!(err instanceof CorosError) || err.kind !== "unauthorized") throw err;
        await refresh();
        return attempt();
      }
    },
  };
  return { link };
}
