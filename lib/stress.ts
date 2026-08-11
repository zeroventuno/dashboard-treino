// ────────────────────────────────────────────────────────────────────────────
//  Training stress, computed instead of typed.
//
//  The fitness chart is driven by TSS per day. Nothing ever wrote it: no coach
//  tool sets it, and the Strava import deliberately leaves it null because
//  Strava's suffer score is a different metric on a different scale and copying
//  it across would poison the curve with a number that merely looks right.
//
//  So the chart that is supposed to show months of accumulated fitness sat
//  empty unless somebody typed a number per session, by hand, forever.
//
//  Elevate — the most mature free tool in this niche — solved the same problem
//  with a family of scores (PSS from power, RSS from grade-adjusted pace, HRSS
//  from heart rate) and picks between them. This is the same idea, with one
//  difference that falls out of our architecture: the zone path below is
//  already measured in the unit the session was PRESCRIBED in, so the choice of
//  formula inherits the same guard as the adherence score rather than needing
//  a preference nobody can set correctly for every session.
//
//  Everything is the one canonical form:
//
//      TSS = seconds × IF² / 36        (IF = effort ÷ threshold)
//
//  which is what makes an hour at threshold exactly 100, by definition.
// ────────────────────────────────────────────────────────────────────────────

import type { PerformanceIndicators, Workout } from "./types";
import { parsePace, paceToSpeed } from "./gap";
import { unpackZones, ZONE_KEYS, type ZoneSeconds } from "./zone-time";

/** How the number was arrived at. Travels with the score, because "112" means
 * different things depending on whether a power meter or a zone histogram
 * produced it, and a coach comparing two athletes deserves to know which. */
export type StressMethod = "power" | "zones" | "pace";

export interface Stress {
  score: number;
  method: StressMethod;
}

/** The canonical form. An hour at threshold (IF = 1) is 100. */
export function stressFrom(seconds: number, intensityFactor: number): number {
  if (!(seconds > 0) || !(intensityFactor > 0)) return 0;
  return (seconds * intensityFactor ** 2) / 36;
}

/**
 * Representative intensity factor for each zone — its midpoint, in the same
 * %-of-threshold breakpoints prescription.ts already uses to turn an intensity
 * into a zone (≤55, ≤75, ≤90, ≤105, above).
 *
 * These sit inside TrainingPeaks' own published IF bands: recovery 0.55-0.65,
 * endurance 0.65-0.75, tempo 0.76-0.85, threshold 0.95-1.05. Per hour they
 * yield 36 / 49 / 64 / 100 / 132, against TP's guidance that an easy endurance
 * hour is 40-60 and a hard interval hour 80-120.
 *
 * A first attempt used Edwards' linear weighting — minutes × zone number — which
 * gave 25/50/75/100/125. Close, and wrong in a way that matters: it is a
 * DIFFERENT equation from the power path, so the same session could score two
 * ways depending only on which data happened to arrive. These midpoints keep
 * all three methods as one formula, differing only in where IF comes from.
 */
const ZONE_IF = [0.6, 0.7, 0.8, 1.0, 1.15];

/**
 * Stress from a zone histogram: each bucket's seconds at that zone's intensity.
 *
 * Coarser than continuous data, and better than it on anything measured by
 * pace — these buckets were filled with GRADE-ADJUSTED speed, so a threshold rep
 * run up a climb lands in zone 4, where a session average would have called the
 * whole run easy.
 *
 * z0 — prescribed time with no target — is excluded. It says nothing about how
 * hard the session was.
 */
export function stressFromZones(z: ZoneSeconds): number {
  return ZONE_KEYS.reduce((sum, key, i) => sum + stressFrom(z[key], ZONE_IF[i]), 0);
}

/** "243W" or "254W avg / 290W max" → 243. The column is free text because a
 * coach writes into it. */
function parseWatts(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = /(\d{2,4})\s*w/i.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * The stress of one completed session, and how it was reached.
 *
 * Ordered by how much each method can be trusted, not by convenience:
 *
 *  1. POWER, for a ride with a meter and an FTP. The number coaches already
 *     think in, computed the way every other tool computes it.
 *  2. ZONES, whenever the device gave us a distribution. Works for any sport,
 *     and carries the grade adjustment on runs.
 *  3. PACE, from the session average. Last because an average pace over rolling
 *     ground describes a run nobody did — but it is still far better than the
 *     blank that used to be there.
 *
 * Returns null rather than guessing when none of the three can be answered. A
 * missing point on the fitness curve is honest; an invented one compounds,
 * because CTL is a rolling average of everything before it.
 */
export function computeStress(w: Workout, ind: PerformanceIndicators | null): Stress | null {
  if (w.status !== "done") return null;
  const seconds = Number(w.actual_duration_min ?? 0) * 60;
  if (!(seconds > 0)) return null;

  // 1 — power
  const ftp = ind?.ftp_watts ? Number(ind.ftp_watts) : null;
  const watts = parseWatts(w.actual_power_watts);
  if (w.discipline === "bike" && ftp && watts) {
    return { score: Math.round(stressFrom(seconds, watts / ftp)), method: "power" };
  }

  // 2 — zones
  const measured = unpackZones(w.actual_zones);
  if (measured) {
    const score = Math.round(stressFromZones(measured.seconds));
    if (score > 0) return { score, method: "zones" };
  }

  // 3 — pace
  const threshold =
    w.discipline === "run" ? parsePace(ind?.run_threshold_pace ?? "")
    : w.discipline === "swim" ? parsePace(ind?.swim_pace_per_100m ?? "")
    : null;
  const actual = parsePace(w.actual_pace ?? "");
  if (threshold && actual) {
    // Intensity is a ratio of SPEEDS. Taking it on the pace numbers themselves
    // inverts the scale — a faster run has a SMALLER pace — and would score the
    // hardest sessions lowest.
    const ratio = paceToSpeed(actual) / paceToSpeed(threshold);
    return { score: Math.round(stressFrom(seconds, ratio)), method: "pace" };
  }

  return null;
}

/**
 * Fill in the stress of every session that has none.
 *
 * A value the coach typed always wins: they may be scoring something the
 * numbers can't see, and this is an estimate standing in for silence, never a
 * correction of a human judgment.
 */
export function withComputedStress(workouts: Workout[], ind: PerformanceIndicators | null): Workout[] {
  return workouts.map((w) => {
    if (w.actual_tss != null || w.status !== "done") return w;
    const s = computeStress(w, ind);
    return s ? { ...w, actual_tss: s.score, tss_method: s.method } : w;
  });
}
