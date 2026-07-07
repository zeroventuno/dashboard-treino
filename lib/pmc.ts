// PMC (Performance Management Chart) — calculations & scales, Strava-style.
// One shared axis for all three series (never dual-axis); Form is plotted at
// its real values, the domain simply extends below zero when needed.
// Pure functions only; rendering lives in components/PmcChart.tsx.
import type { TrainingLoad } from "./types";
import { addDays, parseDate, toISO } from "./utils";

export interface TsbZone {
  key: string;
  label: string;
  min: number; // inclusive
  max: number; // exclusive
}

/** TSB interpretation bands — used for the tooltip label only (no background
 * bands on the chart; they read as clutter at this size). */
export const TSB_ZONES: TsbZone[] = [
  { key: "very-fatigued", label: "Very fatigued",   min: -Infinity, max: -25 },
  { key: "productive",    label: "Productive load", min: -25, max: -10 },
  { key: "neutral",       label: "Neutral",         min: -10, max: 10 },
  { key: "race-ready",    label: "Race ready",      min: 10, max: 25 },
  { key: "very-fresh",    label: "Very fresh",      min: 25, max: Infinity },
];

export function zoneFor(tsb: number): TsbZone {
  return TSB_ZONES.find((z) => tsb >= z.min && tsb < z.max) ?? TSB_ZONES[2];
}

export const RANGE_OPTIONS = [
  { key: "1m", label: "1M", days: 30 },
  { key: "3m", label: "3M", days: 91 },
  { key: "6m", label: "6M", days: 182 },
] as const;
export type RangeKey = (typeof RANGE_OPTIONS)[number]["key"];

/** How far past today the dashed no-training decay projection extends. */
const PROJECTION_DAYS = 14;

export interface PmcPoint {
  date: string;
  tss: number | null;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  /** Dashed continuation past today, assuming zero training load (decay). */
  ctlProj: number | null;
  atlProj: number | null;
  tsbProj: number | null;
  isToday: boolean;
}

export interface PmcSeries {
  points: PmcPoint[];
  /** One shared y domain for all series: dips below 0 only if Form does. */
  yDomain: [number, number];
  maxTss: number;
  lastReal: { date: string; ctl: number; atl: number; tsb: number } | null;
}

/**
 * Windows the history to `rangeDays`, then appends a PROJECTION_DAYS decay
 * tail (CTL/ATL relax toward zero with their 42d/7d time constants — what
 * happens if no more training is logged; Form rebounds as fatigue fades).
 * The last real point carries both real and projected values so the dashed
 * lines connect seamlessly to the solid ones.
 */
export function preparePmcSeries(data: TrainingLoad[], rangeDays: number): PmcSeries {
  const windowed = data.slice(-rangeDays);

  const points: PmcPoint[] = windowed.map((d, i) => ({
    date: d.date,
    tss: d.tss,
    ctl: d.ctl,
    atl: d.atl,
    tsb: d.tsb,
    ctlProj: null,
    atlProj: null,
    tsbProj: null,
    isToday: i === windowed.length - 1,
  }));

  const last = points[points.length - 1];
  let lastReal: PmcSeries["lastReal"] = null;

  if (last && last.ctl != null && last.atl != null) {
    lastReal = { date: last.date, ctl: last.ctl, atl: last.atl, tsb: last.tsb ?? last.ctl - last.atl };
    // bridge point: projection starts exactly where the solid lines end
    last.ctlProj = last.ctl;
    last.atlProj = last.atl;
    last.tsbProj = last.tsb;

    let ctl = last.ctl;
    let atl = last.atl;
    let cursor = parseDate(last.date);
    for (let i = 1; i <= PROJECTION_DAYS; i++) {
      const tsb = ctl - atl; // TSB[t] = CTL[t-1] - ATL[t-1]
      ctl = ctl + (0 - ctl) / 42;
      atl = atl + (0 - atl) / 7;
      cursor = addDays(cursor, 1);
      points.push({
        date: toISO(cursor),
        tss: null, ctl: null, atl: null, tsb: null,
        ctlProj: +ctl.toFixed(1),
        atlProj: +atl.toFixed(1),
        tsbProj: +tsb.toFixed(1),
        isToday: false,
      });
    }
  }

  const highs = points.flatMap((p) => [p.ctl, p.atl, p.ctlProj, p.atlProj]).filter((v): v is number => v != null);
  const lows = points.flatMap((p) => [p.tsb, p.tsbProj]).filter((v): v is number => v != null);
  const rawMax = Math.max(10, ...highs);
  const rawMin = Math.min(0, ...lows);
  const yDomain: [number, number] = [
    Math.floor((rawMin * 1.1) / 10) * 10,
    Math.ceil((rawMax * 1.1) / 10) * 10,
  ];

  const maxTss = Math.max(1, ...points.map((p) => p.tss ?? 0));

  return { points, yDomain, maxTss, lastReal };
}
