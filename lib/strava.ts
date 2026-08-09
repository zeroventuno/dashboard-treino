// ────────────────────────────────────────────────────────────────────────────
//  Strava → the dashboard's own model.
//
//  Chosen as the first device source because it needs no partnership approval
//  and most athletes already sync Garmin, Coros, Polar or Suunto into it, so one
//  integration covers four brands. Garmin's own API gives richer data (HRV,
//  sleep, Body Battery) but gates access behind a business review — worth asking
//  for once there are agencies to show them, not before.
//
//  Deliberately scoped to ACTIVITIES. The principle: automate what the watch
//  already knows, and keep the conversation for what only the athlete knows.
//  A session's duration and distance are facts the device recorded — retyping
//  them is pure friction. How they slept is not; that exchange is the coaching
//  relationship, and Strava couldn't answer it anyway.
// ────────────────────────────────────────────────────────────────────────────

import type { Discipline } from "./types";

const API = "https://www.strava.com/api/v3";
const OAUTH = "https://www.strava.com/oauth";

export const hasStrava = () =>
  Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);

/** Read-only on purpose: the product imports sessions, it never posts to Strava. */
const SCOPE = "read,activity:read_all";

export function authorizeUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    approval_prompt: "auto",
    scope: SCOPE,
    state,
  });
  return `${OAUTH}/authorize?${p}`;
}

export interface StravaTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
  athlete_id?: string;
  scope?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<StravaTokens> {
  const res = await fetch(`${OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      ...body,
    }),
  });
  if (!res.ok) throw new Error(`strava token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as StravaTokens & { athlete?: { id: number } };
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: j.expires_at,
    athlete_id: j.athlete?.id ? String(j.athlete.id) : undefined,
    scope: j.scope,
  };
}

export const exchangeCode = (code: string) => tokenRequest({ code, grant_type: "authorization_code" });
export const refreshTokens = (refreshToken: string) =>
  tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  start_date_local: string;
  moving_time: number;      // seconds
  elapsed_time: number;
  distance: number;         // metres
  average_speed?: number;   // m/s
  average_watts?: number;
  weighted_average_watts?: number;
  average_heartrate?: number;
  total_elevation_gain?: number;
  trainer?: boolean;
}

export async function fetchActivities(accessToken: string, afterUnix: number): Promise<StravaActivity[]> {
  const p = new URLSearchParams({ after: String(afterUnix), per_page: "100" });
  const res = await fetch(`${API}/athlete/activities?${p}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`strava activities ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as StravaActivity[];
}

/** Strava's sport vocabulary → ours. Anything we don't program returns null and
 * is skipped: importing a yoga class as "strength" would quietly corrupt the
 * muscle map and the weekly totals. */
export function toDiscipline(a: StravaActivity): Discipline | null {
  const t = (a.sport_type ?? a.type ?? "").toLowerCase();
  if (t.includes("swim")) return "swim";
  if (t.includes("ride") || t.includes("bike") || t.includes("cycl")) return "bike";
  if (t.includes("run") || t.includes("treadmill")) return "run";
  if (t.includes("weight") || t.includes("workout") || t.includes("crossfit")) return "strength";
  return null;
}

/** "4:35/km", or "1:53/100m" for swimming — the units each sport is read in. */
export function paceFrom(a: StravaActivity, discipline: Discipline): string | null {
  const metres = a.distance;
  const seconds = a.moving_time;
  if (!(metres > 0) || !(seconds > 0)) return null;
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  if (discipline === "swim") return `${mmss((seconds / metres) * 100)}/100m`;
  if (discipline === "run") return `${mmss((seconds / metres) * 1000)}/km`;
  return null; // bike is read in watts and km/h, not pace
}

export interface ImportedWorkout {
  external_id: string;
  date: string;
  discipline: Discipline;
  title: string;
  actual_duration_min: number;
  actual_distance_km: number | null;
  actual_pace: string | null;
  actual_power_watts: string | null;
}

/**
 * One Strava activity as a row this product understands, or null when it isn't
 * a discipline we program.
 *
 * TSS is deliberately absent. Strava's "suffer score" is a different metric with
 * a different scale, and copying it into actual_tss would poison the fitness
 * chart and the weekly load with a number that merely looks right. The coach or
 * the AI fills TSS in; a blank is honest, a wrong number is not.
 */
export function toWorkout(a: StravaActivity): ImportedWorkout | null {
  const discipline = toDiscipline(a);
  if (!discipline) return null;
  const km = a.distance > 0 ? Math.round((a.distance / 1000) * 100) / 100 : null;
  const watts = a.weighted_average_watts ?? a.average_watts;
  return {
    external_id: `strava:${a.id}`,
    date: a.start_date_local.slice(0, 10),
    discipline,
    title: a.name?.trim() || discipline,
    actual_duration_min: Math.round((a.moving_time / 60) * 10) / 10,
    actual_distance_km: km,
    actual_pace: paceFrom(a, discipline),
    actual_power_watts: discipline === "bike" && watts ? `${Math.round(watts)}W` : null,
  };
}
