// ────────────────────────────────────────────────────────────────────────────
//  Daily signals — the HISTORY of the check-in, not today's traffic light.
//
//  `checkins` already stores hrv, sleep_hours, readiness_score, body_battery and
//  resting_hr for every day the athlete logged one, and lib/data-product loads
//  the whole table on every render. The dashboard was drawing exactly one row of
//  it: today. But the question an endurance athlete actually asks is not "what
//  was my HRV on Tuesday", it is "has it been drifting down for three weeks" —
//  and that question was unanswerable from a product that already had the answer
//  in memory. Nothing here fetches anything new.
//
//  ── ABSENCE IS NOT ZERO, AND IT IS NOT A STRAIGHT LINE EITHER ──────────────
//  Athletes miss check-ins, and some log HRV on a morning they never logged
//  sleep. Two ways of lying about that had to be designed out:
//
//    · a missing day drawn as 0 — a night that was never recorded then reads as
//      a night with no sleep, and the average it feeds is wrong besides;
//    · a missing day drawn as *nothing at all* — plot only the rows that exist
//      and a ten-day gap silently collapses into one straight segment between
//      its neighbours, which is a confident claim about ten days nobody
//      measured. This is the subtler failure and the more dishonest one.
//
//  So: the window is expanded to a dense day grid (every date in range, `null`
//  where there is no reading), each day's value is a discrete point that simply
//  does not exist when there was no reading, the rolling mean is `null` — the
//  line BREAKS — wherever the trailing window holds too few readings to average
//  honestly, and the days with no reading are *drawn*, as their own mark on
//  their own row, and counted in words.
//
//  That is the same principle this codebase already applies elsewhere: z0 in
//  lib/zone-time is open time given its own bucket rather than being counted as
//  zero minutes in a zone, and `never` in lib/testing is its own state rather
//  than a very old test date. Absence is a fact about the data, so it gets
//  rendered as one.
//
//  ── AND NOTHING HERE INTERPRETS ────────────────────────────────────────────
//  No verdicts. A low HRV is not coloured "bad", no state is inferred from a
//  combination of series, and the series colours are identity colours, never the
//  readiness good/warn/bad palette. The only reference drawn is the athlete's
//  own mean over the window they chose. This product shows; it does not
//  diagnose.
//
//  Pure functions only; rendering lives in components/VitalsTrends.tsx.
// ────────────────────────────────────────────────────────────────────────────

import type { Checkin } from "./types";
import type { TKey } from "./i18n";
import { blockAvailable, type Metric } from "./tenant-config";
import { RANGE_OPTIONS } from "./pmc";
import { addDays, daysBetween, parseDate, toISO } from "./utils";

/** Fields of a check-in this block trends. All five arrive in the same row. */
export type VitalKey = "hrv" | "sleep_hours" | "readiness_score" | "body_battery" | "resting_hr";

export interface VitalSeriesDef {
  key: VitalKey;
  labelKey: TKey;
  unit: string;
  decimals: number;
  color: string;
  /**
   * Read by the SAME `blockAvailable` the block grid uses — this is the
   * `requires:` mechanism from lib/blocks.ts applied one level down, per series
   * instead of per block.
   *
   * It has to work per series, because `requires` is an AND and this block is a
   * union: gating the whole card on ["hrv","sleep","readiness","body_battery"]
   * would hide four working charts from an athlete missing one strap, and
   * gating it on any single one of them is arbitrary. So the card itself
   * declares no metrics and every series declares its own; a series survives
   * only if the athlete both DECLARED the metric and has real readings for it
   * (see prepareVitals). An athlete with no HRV strap never sees an empty HRV
   * chart, because they never see an HRV chart.
   */
  requires: Metric[];
}

/** Resting HR has no capability flag of its own in lib/tenant-config, and
 * inventing one would mean every existing profile silently losing the series.
 * Every device that produces the rest of this row produces resting HR, so it is
 * gated on data alone — which is the same second gate the other four pass. */
export const VITAL_SERIES: VitalSeriesDef[] = [
  { key: "hrv",             labelKey: "vitals.hrv",         unit: "ms",  decimals: 0, color: "var(--teal)",     requires: ["hrv"] },
  { key: "sleep_hours",     labelKey: "vitals.sleep",       unit: "h",   decimals: 1, color: "var(--swim)",     requires: ["sleep"] },
  { key: "readiness_score", labelKey: "vitals.readiness",   unit: "",    decimals: 0, color: "var(--lime)",     requires: ["readiness"] },
  { key: "body_battery",    labelKey: "vitals.bodyBattery", unit: "",    decimals: 0, color: "var(--strength)", requires: ["body_battery"] },
  { key: "resting_hr",      labelKey: "vitals.restingHr",   unit: "bpm", decimals: 0, color: "var(--bike)",     requires: [] },
];

/** Every metric the series gate on, derived so it can't drift out of sync.
 * For the owner's personal dashboard (/me), which has all the data and no
 * tenant config to declare it — there, the second gate (does a reading exist)
 * is the only one that does any work. */
export const VITALS_METRICS: Metric[] = Array.from(new Set(VITAL_SERIES.flatMap((s) => s.requires)));

/** Trailing window for the smoothed line. */
export const ROLLING_DAYS = 7;

/**
 * How many real readings that window must contain before a mean is drawn.
 *
 * A "7-day average" computed from a single reading is not a 7-day average, it is
 * that reading wearing a smoothed line's clothes — and drawn across a gap it
 * becomes the interpolation this whole file exists to avoid. Below the floor the
 * mean is null and the line stops; it resumes when the athlete resumes logging.
 */
export const ROLLING_MIN_SAMPLES = 3;

/** Longest window the range picker offers — what "does this athlete have any
 * history at all" is decided over. */
export const MAX_RANGE_DAYS = Math.max(...RANGE_OPTIONS.map((r) => r.days));

export interface VitalPoint {
  /** Position on the dense day grid. Shared by every series, so a gap in one
   * lines up with the same calendar day in the others. */
  idx: number;
  date: string;
  /** The reading. `null` = no reading that day — never 0, never carried over. */
  value: number | null;
  /** Trailing rolling mean, `null` where the window is too empty to average. */
  mean: number | null;
  /** 1 on days with no reading, `null` otherwise — drives the missing-day row
   * under the plot, so absence is drawn instead of merely left blank. */
  gap: number | null;
}

export interface VitalSeriesData {
  def: VitalSeriesDef;
  points: VitalPoint[];
  /** Padded value domain. Deliberately NOT anchored to zero: an HRV axis from 0
   * flattens the only thing this chart is for. */
  domain: [number, number];
  latest: { date: string; value: number } | null;
  min: number | null;
  max: number | null;
  /** Mean over the readings in the window — the athlete's own reference line. */
  mean: number | null;
  /** Change in the rolling mean from the first day it could be computed to the
   * last. Direction only; the UI never colours it good or bad. */
  delta: number | null;
  logged: number;
  missing: number;
}

export interface VitalsWindow {
  startISO: string;
  endISO: string;
  days: number;
  series: VitalSeriesData[];
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Trailing mean over `window` days, null unless at least `minSamples` of those
 * days carried a real reading. Index i covers days [i-window+1 … i], so the
 * value at any point is only ever made of days at or before it.
 */
export function rollingMean(
  values: (number | null)[],
  window = ROLLING_DAYS,
  minSamples = ROLLING_MIN_SAMPLES,
): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      const v = values[j];
      if (v != null) { sum += v; n++; }
    }
    out.push(n >= minSamples ? sum / n : null);
  }
  return out;
}

/**
 * Expands the check-ins to one entry per calendar day in the window.
 *
 * The expansion is the point. `checkins` has no row for a skipped day, so any
 * chart driven straight off the array draws the two days either side of a gap
 * as neighbours — the gap disappears and the line through it looks like data.
 * Here every date in range exists, and the days nobody logged carry `null`.
 *
 * The window always ends at `todayISO`, even when the last check-in is weeks
 * old: an athlete who stopped logging should see that they stopped, not a chart
 * that quietly ends where their diligence did.
 */
export function buildDayGrid(
  checkins: Checkin[],
  rangeDays: number,
  todayISO: string,
): { startISO: string; endISO: string; dates: string[]; rows: (Checkin | null)[] } {
  const byDate = new Map<string, Checkin>();
  let lastISO = todayISO;
  for (const c of checkins) {
    if (!c?.date) continue;
    const iso = String(c.date).slice(0, 10);
    byDate.set(iso, c);
    if (iso > lastISO) lastISO = iso;
  }

  const endISO = lastISO;
  const startISO = toISO(addDays(parseDate(endISO), -(rangeDays - 1)));
  const span = daysBetween(startISO, endISO) + 1;

  const dates: string[] = [];
  const rows: (Checkin | null)[] = [];
  let cursor = parseDate(startISO);
  for (let i = 0; i < span; i++) {
    const iso = toISO(cursor);
    dates.push(iso);
    rows.push(byDate.get(iso) ?? null);
    cursor = addDays(cursor, 1);
  }
  return { startISO, endISO, dates, rows };
}

/** Value domain with breathing room, and extra clearance at the bottom for the
 * missing-day row that shares the plot's lower band. */
function domainFor(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || Math.max(1, Math.abs(hi) * 0.1);
  return [lo - span * 0.34, hi + span * 0.14];
}

/**
 * Everything one range of the block needs.
 *
 * Two gates, both required, in this order:
 *   1. the athlete DECLARED the metric (`blockAvailable`, exactly as the block
 *      grid gates whole cards);
 *   2. the window actually contains a reading for it.
 *
 * Either one failing drops the series entirely rather than drawing it empty —
 * an empty chart is read as a bad number or a broken product, never as "you do
 * not own this device".
 */
export function prepareVitals(
  checkins: Checkin[],
  metrics: Metric[],
  rangeDays: number,
  todayISO: string,
  /** Series to keep even when this particular window holds no reading for them
   * — see stableSeriesKeys. Omit to drop empty ones. */
  keep?: VitalKey[] | null,
): VitalsWindow {
  const { startISO, endISO, dates, rows } = buildDayGrid(checkins, rangeDays, todayISO);

  const series: VitalSeriesData[] = [];
  for (const def of VITAL_SERIES) {
    if (!blockAvailable(def.requires, metrics)) continue;
    if (keep && !keep.includes(def.key)) continue;

    const raw = rows.map((r) => (r ? num(r[def.key]) : null));
    const real = raw.filter((v): v is number => v != null);
    if (real.length === 0 && !keep) continue;

    const means = rollingMean(raw);
    const points: VitalPoint[] = dates.map((date, idx) => ({
      idx,
      date,
      value: raw[idx],
      mean: means[idx],
      gap: raw[idx] == null ? 1 : null,
    }));

    let latest: VitalSeriesData["latest"] = null;
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].value != null) { latest = { date: points[i].date, value: points[i].value! }; break; }
    }
    const drawnMeans = means.filter((v): v is number => v != null);
    const delta = drawnMeans.length > 1 ? drawnMeans[drawnMeans.length - 1] - drawnMeans[0] : null;

    series.push({
      def,
      points,
      domain: domainFor(real),
      latest,
      min: real.length ? Math.min(...real) : null,
      max: real.length ? Math.max(...real) : null,
      mean: real.length ? real.reduce((s, v) => s + v, 0) / real.length : null,
      delta,
      logged: real.length,
      missing: raw.length - real.length,
    });
  }

  return { startISO, endISO, days: dates.length, series };
}

/**
 * Does this athlete have anything to show at all, over the widest window the
 * picker offers? Answered on the server so the block can decline to render
 * rather than parking an empty card below the hero forever.
 *
 * Deliberately the WIDEST range: which series exist must not change when the
 * athlete flips 6M → 1M, or the grid reshuffles under their finger. Inside a
 * narrower range a series with no readings keeps its panel and says so.
 */
export function hasVitals(checkins: Checkin[], metrics: Metric[], todayISO: string): boolean {
  return prepareVitals(checkins, metrics, MAX_RANGE_DAYS, todayISO).series.length > 0;
}

/** The series to draw, fixed by the widest range so the grid never reshuffles
 * when the range changes. */
export function stableSeriesKeys(checkins: Checkin[], metrics: Metric[], todayISO: string): VitalKey[] {
  return prepareVitals(checkins, metrics, MAX_RANGE_DAYS, todayISO).series.map((s) => s.def.key);
}
