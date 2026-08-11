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

import type { Discipline, PerformanceIndicators, ZoneSeconds } from "./types";
import { actualZones, parseBands, parsePaceBands, type Sample } from "./zone-time";
import { adjustedSpeed } from "./gap";
import type { Unit } from "./prescription";

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
  /** Athlete ticked "mark as commute". Documented Strava field: a ride to work
   * is never a prescribed session, however closely its length happens to
   * resemble one. */
  commute?: boolean;
}

export async function fetchActivities(accessToken: string, afterUnix: number): Promise<StravaActivity[]> {
  const p = new URLSearchParams({ after: String(afterUnix), per_page: "100" });
  const res = await fetch(`${API}/athlete/activities?${p}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`strava activities ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as StravaActivity[];
}

/** The per-second recording. Only the channels time in zone needs — asking for
 * GPS traces and raw altitude would multiply the payload for nothing.
 *
 * `velocity_smooth` and `grade_smooth` are here for running: pace zones are
 * scored on grade-adjusted speed, so the gradient has to come along with it.
 * Strava reports grade already smoothed, in PERCENT, which saves differentiating
 * a noisy altitude trace ourselves. */
export interface StravaStreams {
  time?: { data: number[] };
  watts?: { data: (number | null)[] };
  heartrate?: { data: (number | null)[] };
  moving?: { data: boolean[] };
  velocity_smooth?: { data: (number | null)[] };
  grade_smooth?: { data: (number | null)[] };
}

const STREAM_KEYS = "time,watts,heartrate,moving,velocity_smooth,grade_smooth";

/**
 * Fetch one activity's stream. This is the expensive call — one per activity, on
 * an allowance shared by every athlete in the product — so the caller decides
 * when it's worth spending: see the sync route, which only asks for sessions
 * that matched something the coach actually prescribed.
 *
 * Returns null rather than throwing. A missing stream (an activity logged by
 * hand, a device that recorded nothing) must not fail the whole import — the
 * session still counts, it just gets scored the old way.
 */
export async function fetchStreams(accessToken: string, activityId: string): Promise<StravaStreams | null> {
  const p = new URLSearchParams({ keys: STREAM_KEYS, key_by_type: "true" });
  const res = await fetch(`${API}/activities/${activityId}/streams?${p}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null; // no recording attached
  if (!res.ok) {
    console.warn(`[strava] streams ${activityId} → ${res.status}`);
    return null;
  }
  return (await res.json()) as StravaStreams;
}

/**
 * Reduce a stream to seconds per zone — the only thing we keep.
 *
 * The per-second recording is thrown away on purpose. It's tens of thousands of
 * numbers per session, and a coach reading a roster of 100 athletes needs the
 * six totals, not the raw trace. Storing the trace would mean warehousing Strava
 * data we'd be obliged to delete if the API relationship ever ended.
 *
 * Power for the bike, heart rate for everything else — power is what a cyclist's
 * zones are actually written in, and it responds instantly where heart rate lags
 * a couple of minutes behind an interval. Falls back to heart rate when the
 * athlete has no meter or no power zones set.
 */
export function streamsToZones(
  streams: StravaStreams | null,
  indicators: PerformanceIndicators | null,
  discipline: Discipline,
  /** The metric the session was PRESCRIBED in. Measurement follows the
   * instruction rather than picking the richest channel available: a run
   * written in pace has to be judged in pace, even for an athlete wearing a
   * strap. Omit to fall back to the best channel for the sport. */
  want?: Unit,
): { seconds: ZoneSeconds; metric: Unit } | null {
  if (!streams?.time?.data?.length) return null;

  const time = streams.time.data;
  const moving = streams.moving?.data;
  const build = (value: (i: number) => number | null): Sample[] =>
    time.map((t, i) => ({ t, v: value(i), moving: moving?.[i] }));

  // Each measurable metric, and how to read it from this recording. Returning
  // null means "this athlete's data can't answer in that unit".
  const byPower = (): ZoneSeconds | null => {
    const bands = parseBands(indicators?.bike_zones);
    const watts = streams.watts?.data;
    if (!bands.length || !watts?.length) return null;
    return actualZones(build((i) => watts[i] ?? null), bands);
  };

  const byPace = (): ZoneSeconds | null => {
    const metres = discipline === "swim" ? 100 : 1000;
    const table = discipline === "swim" ? indicators?.swim_pace_zones : indicators?.run_pace_zones;
    const bands = parsePaceBands(table, metres);
    const speed = streams.velocity_smooth?.data;
    if (!bands.length || !speed?.length) return null;
    const grade = streams.grade_smooth?.data;
    return actualZones(
      build((i) => {
        const v = speed[i];
        if (v == null || v <= 0) return null;
        // Running is corrected for the hill; in the pool there is none.
        // Strava reports grade as a percentage, the model wants a ratio.
        return discipline === "run" ? adjustedSpeed(v, (grade?.[i] ?? 0) / 100) : v;
      }),
      bands,
    );
  };

  const byHeartRate = (): ZoneSeconds | null => {
    const bands = parseBands(indicators?.hr_zones);
    const hr = streams.heartrate?.data;
    if (!bands.length || !hr?.length) return null;
    return actualZones(build((i) => hr[i] ?? null), bands);
  };

  const read: Partial<Record<Unit, () => ZoneSeconds | null>> = {
    power: byPower,
    pace: byPace,
    heart_rate: byHeartRate,
  };

  // What was asked for, first.
  if (want && read[want]) {
    const seconds = read[want]!();
    if (seconds) return { seconds, metric: want };
    // Asked for a unit this recording can't answer in. Fall through rather than
    // return nothing — a measurement in another unit is still worth storing,
    // and the metric travels with it so nothing compares them by accident.
  }

  // No instruction, or the instruction couldn't be honoured: the sport's own
  // ladder, best first.
  const ladder: Unit[] =
    discipline === "bike" ? ["power", "heart_rate"]
    : discipline === "swim" ? ["pace", "heart_rate"]
    : ["pace", "heart_rate"];

  for (const unit of ladder) {
    if (unit === want) continue; // already tried
    const seconds = read[unit]?.();
    if (seconds) return { seconds, metric: unit };
  }

  return null;
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

  // Endurance-adjacent sports the plan doesn't model. A five-hour hike at 93bpm
  // is aerobic volume whatever it's called, and dropping it — which is what
  // returning null did — loses real training. It lands as `other` + `extra`:
  // counted in the week, never mistaken for a prescribed session.
  //
  // Short ones are still skipped. Below the floor these are errands, not
  // training, and a calendar full of ten-minute walks to the shop is noise that
  // makes the real sessions harder to find.
  if (OTHER_SPORTS.test(t)) {
    return a.moving_time >= MIN_OTHER_SECONDS ? "other" : null;
  }
  return null;
}

/** Sports worth importing as `other` — deliberately a list, not a catch-all:
 * every Strava type we don't name stays out, so a new activity type can't start
 * filling the calendar without someone deciding it should. */
const OTHER_SPORTS = /hike|walk|row|ski|snowboard|snowshoe|elliptical|stair|skate|kayak|canoe|surf|climb/;

/** 30 minutes. A judgment call, and the one number here worth arguing about:
 * high enough to skip the walk to the bakery, low enough to keep a short row or
 * a gym-machine session that genuinely loaded the athlete. */
const MIN_OTHER_SECONDS = 30 * 60;

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
  /** Marked as a commute on Strava — import it, but never onto a planned session. */
  commute?: boolean;
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
    // Carried through so the importer can refuse to match it against anything.
    commute: a.commute === true,
  };
}
