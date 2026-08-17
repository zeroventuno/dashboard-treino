// ────────────────────────────────────────────────────────────────────────────
//  The PMC, in ONE place: the recurrence, and the bands that read it.
//
//  This file exists because the same two things were written more than once.
//
//  THE RECURRENCE. CTL and ATL are exponentially weighted averages of daily TSS
//  with 42-day and 7-day time constants; TSB is yesterday's CTL minus yesterday's
//  ATL. lib/data.ts and lib/data-product.ts each grew their own copy, and a
//  third was very nearly written in SQL for the coach roster. Three copies of an
//  accumulating recurrence is three chances for the coach's screen and the
//  athlete's screen to state different facts about the same person on the same
//  day — and because CTL integrates everything before it, a small difference in
//  the rule compounds instead of cancelling. So: one function, called by both.
//
//  THE BANDS. The TSB thresholds were also written twice — lib/pmc.ts drew the
//  chart's zones at -25/-10/+10/+25 while the roster classifier was first
//  written against -30. Two numbers for "this athlete is deeply fatigued", in
//  one product, is precisely the bug this module is meant to end. The constants
//  below are the single source; lib/pmc.ts and lib/roster-load.ts both import
//  them and neither restates a number.
//
//  Pure. No I/O, no clock — `todayISO` is always an argument.
//
//  STILL DUPLICATED, DELIBERATELY: lib/data.ts (the original personal dashboard)
//  keeps its own extendTrainingLoad. It reads a different Supabase project with
//  its own migrated training_load history and is out of scope here; touching it
//  risks the one dashboard that currently works off stored rows. If it is ever
//  folded in, extendCurve is what it should call.
// ────────────────────────────────────────────────────────────────────────────

import type { TrainingLoad, Workout } from "./types";
import { addDays, parseDate, toISO } from "./utils";

/** Time constants, in days. These are the definition of CTL and ATL, not a
 * tuning knob: 42 and 7 are what make "fitness" and "fatigue" mean what every
 * other tool means by them. */
export const CTL_DAYS = 42;
export const ATL_DAYS = 7;

// ── TSB bands — the single source of truth ──────────────────────────────────
//
//  TSB ("Form") = CTL - ATL, both in TSS/day. These are the boundaries the
//  Performance Management Chart is read with (TrainingPeaks / Joe Friel), and
//  the ones this product has been showing athletes since the chart shipped:
//
//    tsb <  -25   very fatigued — the widely used high-fatigue / functional
//                 overreaching marker
//    -25 … -10    productive training load: where a build block is SUPPOSED to
//                 sit. Negative here is the training working, not a problem
//    -10 … +10    neutral
//    +10 … +25    race ready
//    tsb >= +25   very fresh (tapered, or undertrained)
//
//  Read as boundaries of half-open bands [min, max), so a TSB of exactly -25 is
//  "productive", not "very fatigued" — every consumer must use the same
//  comparison or the edges disagree.

/** Below this: very fatigued. */
export const TSB_HIGH_FATIGUE = -25;
/** At or below this (and at/above TSB_HIGH_FATIGUE): productive load. */
export const TSB_PRODUCTIVE = -10;
/** Above this: race ready. */
export const TSB_NEUTRAL_HIGH = 10;
/** At or above this: very fresh. */
export const TSB_VERY_FRESH = 25;

/**
 * The only three fields the curve reads off a session.
 *
 * Structural rather than the full `Workout` so anything session-shaped can feed
 * it — the coach roster assembles rows from a much narrower query than the
 * athlete dashboard does, and both must reach the same curve.
 */
export type TssSource = Pick<Workout, "date" | "actual_tss" | "planned_tss" | "status">;

/**
 * Sessions that are explicitly OUT of the plan and must not carry load.
 *
 * Rescheduling writes two rows: the original struck through as `moved`, and a
 * planned copy on the new date. Counting both put the same session's TSS into
 * the curve twice — the fitness chart read higher than the athlete trained, and
 * the fatigue derived from it read higher still.
 *
 * The weekly volume box already learned this exact lesson (a moved session made
 * 2.5 km read as 10.4) and excludes both statuses. The PMC never got the same
 * fix, so the two screens disagreed about the same week.
 */
const OFF_PLAN = new Set(["cancelled", "moved"]);

/**
 * Total TSS per calendar day.
 *
 * Actual preferred, else planned, else nothing — the athlete's chart and the
 * coach's roster now read this one function, so they cannot drift apart.
 */
export function dailyTss(workouts: TssSource[]): Record<string, number> {
  const byDate: Record<string, number> = {};
  for (const w of workouts) {
    if (w.status && OFF_PLAN.has(w.status)) continue;
    const t = Number(w.actual_tss ?? w.planned_tss ?? 0);
    if (t > 0) byDate[w.date] = (byDate[w.date] ?? 0) + t;
  }
  return byDate;
}

/**
 * Continue a stored PMC up to `todayISO` from session TSS — or build the whole
 * curve from the sessions when there is no stored history at all.
 *
 * Moved verbatim out of lib/data-product.ts; the athlete dashboard now calls
 * this, so any change lands on both screens at once.
 *
 * `training_load` is populated only by a one-off import and by no tool in the
 * product, so in practice the second branch is the one that runs: the curve is
 * built from the sessions themselves, starting at zero — which is exactly what
 * a real PMC looks like for someone just starting out, and is why a curve needs
 * a decent span of history before its TSB means anything (see MIN_HISTORY_DAYS
 * in lib/roster-load.ts).
 */
export function extendCurve(
  load: TrainingLoad[],
  workouts: TssSource[],
  todayISO: string,
): TrainingLoad[] {
  const sorted = [...load].sort((a, b) => (a.date < b.date ? -1 : 1));
  const today = parseDate(todayISO);

  let cursor: Date;
  let ctl: number;
  let atl: number;
  let out: TrainingLoad[];

  if (sorted.length === 0) {
    if (workouts.length === 0) return [];
    const firstISO = workouts.reduce((min, w) => (w.date < min ? w.date : min), workouts[0].date);
    // Step back a day so the loop's first iteration lands ON the first session.
    cursor = addDays(parseDate(firstISO), -1);
    ctl = 0;
    atl = 0;
    out = [];
  } else {
    const last = sorted[sorted.length - 1];
    if (last.ctl == null || last.atl == null) return sorted;
    cursor = parseDate(last.date);
    ctl = last.ctl;
    atl = last.atl;
    out = [...sorted];
  }

  if (cursor >= today) return out.length > 0 ? out : sorted;

  const tssByDate = dailyTss(workouts);

  while (cursor < today) {
    cursor = addDays(cursor, 1);
    const iso = toISO(cursor);
    const tss = Math.round(tssByDate[iso] ?? 0);
    const tsb = ctl - atl; // TSB[t] = CTL[t-1] - ATL[t-1]
    ctl = ctl + (tss - ctl) / CTL_DAYS;
    atl = atl + (tss - atl) / ATL_DAYS;
    out.push({
      date: iso,
      tss,
      ctl: +ctl.toFixed(1),
      atl: +atl.toFixed(1),
      tsb: +tsb.toFixed(1),
      source: "manual",
    });
  }
  return out;
}
