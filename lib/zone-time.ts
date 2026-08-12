// ────────────────────────────────────────────────────────────────────────────
//  Time in zone — what the coach prescribed vs what the athlete actually did.
//
//  Duration, distance and TSS say whether the session HAPPENED. They can't say
//  whether it was the RIGHT session: 4x8min at threshold and an hour of easy
//  spinning are the same 60 minutes, and today they score the same. Time in zone
//  is the metric that tells them apart, and it's the one a polarised method
//  (the 80/20 family) is actually built on — sessions are prescribed by time in
//  a zone, never by distance.
//
//  Everything here is pure: seconds in, seconds out. Fetching streams and
//  storing the result belongs elsewhere.
// ────────────────────────────────────────────────────────────────────────────

import type { WorkoutBlock, ZoneSeconds } from "./types";
import { isOpenBlock } from "./workout-structure";

export type { ZoneSeconds };
export type ZoneKey = "z1" | "z2" | "z3" | "z4" | "z5";
export const ZONE_KEYS: ZoneKey[] = ["z1", "z2", "z3", "z4", "z5"];

export const EMPTY_ZONES: ZoneSeconds = { z0: 0, z1: 0, z2: 0, z3: 0, z4: 0, z5: 0 };

const zeroed = (): ZoneSeconds => ({ ...EMPTY_ZONES });

// ── Reading the athlete's zone table ────────────────────────────────────────

export interface Band {
  zone: ZoneKey;
  min: number;
  max: number;
}

/** Zone labels are written by whoever set them up — "Z2 Endurance", "z2", "Z 2".
 * All that matters is the digit. */
function zoneOfLabel(label: string): ZoneKey | null {
  const m = /z\s*([1-5])/i.exec(label);
  return m ? (`z${m[1]}` as ZoneKey) : null;
}

/**
 * Turn a stored zone table into numeric bands. Handles the shapes that actually
 * occur: a `[min, max]` tuple, "136-183" (either dash), "> 170", "< 128".
 *
 * Pace zones ("4:45–4:30") are deliberately NOT parsed here: they're minutes per
 * km, they run backwards, and a threshold in seconds/km compared against a
 * velocity stream is a different conversion. Power and heart rate cover the bike
 * completely and the run and swim well enough to be useful today.
 */
export function parseBands(zones: Record<string, [number, number] | string> | null | undefined): Band[] {
  if (!zones) return [];
  const bands: Band[] = [];

  for (const [label, value] of Object.entries(zones)) {
    const zone = zoneOfLabel(label);
    if (!zone) continue;

    if (Array.isArray(value)) {
      const [min, max] = value;
      if (Number.isFinite(min) && Number.isFinite(max)) bands.push({ zone, min, max });
      continue;
    }
    if (typeof value !== "string") continue;

    const open = /^\s*([<>])\s*(\d+(?:\.\d+)?)/.exec(value);
    if (open) {
      const n = Number(open[2]);
      bands.push(open[1] === ">" ? { zone, min: n, max: Infinity } : { zone, min: 0, max: n });
      continue;
    }
    // en dash, em dash and hyphen all show up depending on who typed it
    const range = /(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/.exec(value);
    if (range) bands.push({ zone, min: Number(range[1]), max: Number(range[2]) });
  }

  return bands.sort((a, b) => a.min - b.min);
}

/**
 * Pace zone tables → bands in SPEED (m/s).
 *
 * Converting to speed is what makes pace fit the same machinery as power and
 * heart rate. Pace runs backwards — 4:30/km is harder than 5:00/km — so bands
 * read as descending numbers and every comparison downstream would need to know
 * which metric it was looking at. One conversion here and a higher value means
 * a harder effort everywhere, exactly like watts.
 *
 * `metresPerUnit` is 1000 for running (min/km) and 100 for swimming
 * (min/100m) — the tables are written in different units and the resulting
 * speeds have to be comparable to the samples they'll be matched against.
 */
export function parsePaceBands(
  zones: Record<string, [number, number] | string> | null | undefined,
  metresPerUnit = 1000,
): Band[] {
  if (!zones) return [];
  const speed = (secs: number) => (secs > 0 ? metresPerUnit / secs : 0);
  const bands: Band[] = [];

  for (const [label, value] of Object.entries(zones)) {
    const zone = zoneOfLabel(label);
    if (!zone || typeof value !== "string") continue;

    const open = /^\s*([<>])\s*(\d{1,2}):([0-5]\d)/.exec(value);
    if (open) {
      const secs = Number(open[2]) * 60 + Number(open[3]);
      // "> 2:05" means SLOWER than 2:05, which is a LOWER speed — the operator
      // flips along with the unit.
      bands.push(
        open[1] === ">"
          ? { zone, min: 0, max: speed(secs) }
          : { zone, min: speed(secs), max: Infinity },
      );
      continue;
    }

    const range = /(\d{1,2}):([0-5]\d)\s*[-–—]\s*(\d{1,2}):([0-5]\d)/.exec(value);
    if (!range) continue;
    const a = speed(Number(range[1]) * 60 + Number(range[2]));
    const b = speed(Number(range[3]) * 60 + Number(range[4]));
    bands.push({ zone, min: Math.min(a, b), max: Math.max(a, b) });
  }

  return bands.sort((x, y) => x.min - y.min);
}

/** Which zone a reading falls in. Bands stored as 136-183 / 184-220 leave gaps
 * at the boundaries, so a value between two bands snaps to the lower one rather
 * than being thrown away. */
export function zoneOf(value: number, bands: Band[]): ZoneKey | null {
  if (!bands.length || !Number.isFinite(value)) return null;

  for (const b of bands) if (value >= b.min && value <= b.max) return b.zone;

  // No exact hit: either below everything (recovery), or in a hole between two
  // hand-written bands, or above the top one. Snapping down to the nearest band
  // covers all three — and a reading above the hardest zone is still the hardest
  // zone, not unclassifiable.
  if (value < bands[0].min) return bands[0].zone;
  let below: Band | null = null;
  for (const b of bands) if (b.max < value && (!below || b.max > below.max)) below = b;
  return below?.zone ?? null;
}

// ── What the coach prescribed ───────────────────────────────────────────────

/** % of threshold → zone, for blocks the coach gave an intensity but no zone
 * name. The usual %FTP breakpoints. */
function zoneOfIntensity(pct: number): ZoneKey {
  if (pct <= 55) return "z1";
  if (pct <= 75) return "z2";
  if (pct <= 90) return "z3";
  if (pct <= 105) return "z4";
  return "z5";
}

/**
 * Seconds per zone in the prescription. A block with no zone and no intensity
 * lands in `z0` — open time — instead of being guessed at. Inventing "z1" for a
 * block the coach left blank would mean scoring the athlete against a
 * prescription nobody wrote.
 *
 * Warm-ups, cool-downs, rests and drills land in `z0` EVEN WHEN they carry an
 * intensity, which is the other half of the same rule. Those numbers get
 * attached so the athlete knows roughly what to do; they were never targets to
 * hold. Reading them as prescription is what scored a well-executed swim at 31
 * — two thirds of its "prescribed" time was warm-up and technique work, and
 * drills are slow deliberately, so doing them properly counted against him.
 * See isOpenBlock.
 */
export function plannedZones(blocks: WorkoutBlock[] | null | undefined): ZoneSeconds | null {
  if (!blocks?.length) return null;
  const out = zeroed();

  for (const b of blocks) {
    const secs = Math.round((b.duration_min ?? 0) * 60);
    if (secs <= 0) continue;
    if (isOpenBlock(b.label)) {
      out.z0 += secs;
      continue;
    }
    const named = b.target ? zoneOfLabel(b.target) : null;
    const zone = named ?? (b.intensity != null ? zoneOfIntensity(b.intensity) : null);
    out[zone ?? "z0"] += secs;
  }

  // Nothing but open time is not a prescription to measure against.
  return ZONE_KEYS.some((z) => out[z] > 0) ? out : null;
}

// ── What the athlete actually did ───────────────────────────────────────────

export interface Sample {
  /** Seconds since the start of the activity. */
  t: number;
  /** Watts or heart rate — whichever the bands describe. */
  v: number | null;
  /** Strava's `moving` stream. A stop at a traffic light is not zone 1 time. */
  moving?: boolean;
}

/** A gap longer than this means the watch was paused, not that the athlete
 * spent two minutes at that heart rate. */
const MAX_GAP_S = 30;

/** Seconds per zone from a per-second stream. */
export function actualZones(samples: Sample[], bands: Band[]): ZoneSeconds | null {
  if (!samples.length || !bands.length) return null;
  const out = zeroed();
  let counted = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.v == null || s.moving === false) continue;

    // The last sample has no successor to measure against; give it the cadence
    // of the stream rather than dropping it.
    const next = samples[i + 1];
    const dt = next ? next.t - s.t : samples.length > 1 ? Math.min(MAX_GAP_S, samples[1].t - samples[0].t) : 1;
    if (dt <= 0 || dt > MAX_GAP_S) continue;

    const zone = zoneOf(s.v, bands);
    if (!zone) continue;
    out[zone] += dt;
    counted += dt;
  }

  return counted > 0 ? out : null;
}

// ── The comparison ──────────────────────────────────────────────────────────

export const totalSeconds = (z: ZoneSeconds): number =>
  z.z0 + ZONE_KEYS.reduce((sum, k) => sum + z[k], 0);

/**
 * How much of the prescription actually happened, 0-100.
 *
 *   score = overlapping seconds / the longer of the two sessions
 *
 * Overlap (`min` per zone) is what makes this say something the duration check
 * can't: an hour of easy riding when the coach asked for 48min Z2 + 12min Z4
 * scores 80, not 100 — the volume was there, the intensity wasn't.
 *
 * Dividing by the LONGER total is what keeps it honest in both directions.
 * Twenty minutes of a perfectly-paced hour scores 33, and ninety minutes when
 * sixty were prescribed scores 67: overshooting the plan is off-plan too, the
 * same principle the duration estimate already follows.
 *
 * `z0` — time the coach left open — absorbs whatever the athlete did in it. If
 * no target was given, no target can be missed.
 */
export function zoneAdherence(
  planned: ZoneSeconds | null,
  actual: ZoneSeconds | null,
  /** The metric each side is expressed in. When they disagree the comparison is
   * refused — see below. Omit both to compare unconditionally. */
  metrics?: { planned?: string | null; actual?: string | null },
): number | null {
  if (!planned || !actual) return null;

  // Two metrics are not one scale. A brick run prescribed at 6:20-6:40/km and
  // measured by heart rate scored 4 out of 100 — the athlete ran exactly the
  // pace asked, on tired legs, and an elevated heart rate at an easy pace off
  // the bike is the whole point of a brick. Returning null here drops the
  // caller back to the duration estimate, which is vaguer and true. A confident
  // wrong number is worse than an honest rough one.
  if (metrics?.planned && metrics?.actual && metrics.planned !== metrics.actual) return null;

  const totalP = totalSeconds(planned);
  const totalA = totalSeconds(actual);
  if (totalP <= 0 || totalA <= 0) return null;

  let hit = 0;
  for (const z of ZONE_KEYS) hit += Math.min(planned[z], actual[z]);
  // Open time credits the leftover, capped at how much was left open.
  hit += Math.min(planned.z0, Math.max(0, totalA - hit));

  return Math.max(0, Math.min(100, Math.round((hit / Math.max(totalP, totalA)) * 100)));
}

/** Which zone the athlete spent the most prescribed-vs-actual difference in —
 * the one line a coach needs: "you were meant to be in z4 and you weren't". */
export function biggestMiss(planned: ZoneSeconds, actual: ZoneSeconds): { zone: ZoneKey; seconds: number } | null {
  let worst: { zone: ZoneKey; seconds: number } | null = null;
  for (const z of ZONE_KEYS) {
    const missing = planned[z] - actual[z];
    if (missing > 0 && (!worst || missing > worst.seconds)) worst = { zone: z, seconds: missing };
  }
  return worst;
}

// ── The week ────────────────────────────────────────────────────────────────

/**
 * The easy/hard split — the 80/20 reading.
 *
 * This is a property of the WEEK, not of a session: a set of VO2 intervals is
 * 100% hard and completely correct, because it IS the 20%. Judging one workout
 * against 80/20 would flag every quality session in the plan.
 */
export function intensitySplit(weeks: ZoneSeconds[]): { easyPct: number; hardPct: number; seconds: number } | null {
  let easy = 0, hard = 0;
  for (const z of weeks) {
    easy += z.z1 + z.z2;
    hard += z.z3 + z.z4 + z.z5;
  }
  const total = easy + hard;
  if (total <= 0) return null;
  return {
    easyPct: Math.round((easy / total) * 100),
    hardPct: Math.round((hard / total) * 100),
    seconds: total,
  };
}

// ── Remembering how it was measured ─────────────────────────────────────────

/**
 * Zone seconds plus the metric they were measured in, as stored.
 *
 * The metric rides inside the same jsonb rather than in a new column: the
 * CHECK constraint asks that z0-z5 are present and numeric, and tolerates extra
 * keys, so this needs no migration. Rows written before the metric existed
 * simply read back as null — unknown, not wrong.
 */
export function packZones(seconds: ZoneSeconds, metric: string): Record<string, number | string> {
  return { ...seconds, metric };
}

export function unpackZones(raw: unknown): { seconds: ZoneSeconds; metric: string | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const out = zeroed();
  let any = false;
  for (const k of ["z0", ...ZONE_KEYS] as const) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = v;
      any = true;
    }
  }
  if (!any) return null;
  return { seconds: out, metric: typeof o.metric === "string" ? o.metric : null };
}

/** Add up zone time across sessions. */
export function sumZones(all: (ZoneSeconds | null | undefined)[]): ZoneSeconds {
  const out = zeroed();
  for (const z of all) {
    if (!z) continue;
    out.z0 += z.z0;
    for (const k of ZONE_KEYS) out[k] += z[k];
  }
  return out;
}
