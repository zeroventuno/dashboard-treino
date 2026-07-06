// PMC (Performance Management Chart) — calculations & scales.
// Pure functions only; rendering lives in components/PmcChart.tsx.
import type { TrainingLoad } from "./types";

export type PmcMode = "real" | "classic";

export interface TsbZone {
  key: string;
  label: string;
  min: number; // inclusive
  max: number; // exclusive
  color: string; // CSS var, used for both the background band and its legend dot
}

// ---------------------------------------------------------------------------
// Configuration — thresholds/colors/margins. Tune here without touching the
// calculation or rendering code.
// ---------------------------------------------------------------------------

/** TSB interpretation bands, most-fatigued to most-fresh. */
export const TSB_ZONES: TsbZone[] = [
  { key: "very-fatigued", label: "Very fatigued",   min: -Infinity, max: -25, color: "var(--bad)" },
  { key: "productive",    label: "Productive load", min: -25, max: -10, color: "var(--teal)" },
  { key: "neutral",       label: "Neutral",         min: -10, max: 10, color: "var(--text-faint)" },
  { key: "race-ready",    label: "Race ready",      min: 10, max: 25, color: "var(--lime)" },
  { key: "very-fresh",    label: "Very fresh",      min: 25, max: Infinity, color: "var(--good)" },
];

/** The right (TSB) axis never collapses tighter than ±this, so a quiet week
 * doesn't make the line look artificially dramatic — and every zone band
 * (thresholds go up to ±25) always has room to render, even when actual TSB
 * never swings that far. */
const RIGHT_AXIS_MIN_HALF_SPAN = Math.max(...TSB_ZONES.filter((z) => Number.isFinite(z.max)).map((z) => z.max)) + 5;
const RIGHT_AXIS_MARGIN_FACTOR = 1.15;
const LEFT_AXIS_MARGIN_FACTOR = 1.1;

// ---------------------------------------------------------------------------
// Scales
// ---------------------------------------------------------------------------

/** Left axis (Fitness/Fatigue): 0 → just above the largest observed value. */
export function computeLeftDomain(values: number[]): [number, number] {
  const max = Math.max(10, ...values);
  const rounded = Math.ceil((max * LEFT_AXIS_MARGIN_FACTOR) / 10) * 10;
  return [0, rounded];
}

/** Right axis (Form): symmetric around zero, adaptive to the data. */
export function computeRightDomain(tsbValues: number[]): [number, number] {
  const absMax = Math.max(1, ...tsbValues.map((v) => Math.abs(v)));
  const rounded = Math.ceil((absMax * RIGHT_AXIS_MARGIN_FACTOR) / 5) * 5;
  const bound = Math.max(RIGHT_AXIS_MIN_HALF_SPAN, rounded);
  return [-bound, bound];
}

export function zoneFor(tsb: number): TsbZone {
  return TSB_ZONES.find((z) => tsb >= z.min && tsb < z.max) ?? TSB_ZONES[2];
}

/**
 * "Classic" PMC overlay (TrainingPeaks-style): compress TSB into the same
 * vertical band as CTL/ATL so all three share one axis. TSB=0 sits at the
 * midpoint of the CTL/ATL band; the right-axis domain sets how far a TSB
 * swing travels within that band.
 */
export function mapToClassicScale(
  tsb: number,
  rightDomain: [number, number],
  leftDomain: [number, number],
): number {
  const [, rMax] = rightDomain;
  const [, lMax] = leftDomain;
  const mid = lMax / 2;
  const amplitude = lMax / 2;
  const clamped = Math.min(rMax, Math.max(-rMax, tsb));
  return mid + (clamped / rMax) * amplitude;
}

// ---------------------------------------------------------------------------
// Series prep
// ---------------------------------------------------------------------------

export interface PmcPoint extends TrainingLoad {
  /** Real-mode split-fill: TSB clamped to >=0 (else 0), for the green area. */
  tsbPositive: number | null;
  /** Real-mode split-fill: TSB clamped to <=0 (else 0), for the blue-gray area. */
  tsbNegative: number | null;
  /** Classic-mode single-line value, plotted on the left axis. */
  tsbClassic: number | null;
}

export interface PmcSeries {
  points: PmcPoint[];
  leftDomain: [number, number];
  rightDomain: [number, number];
}

export function preparePmcSeries(data: TrainingLoad[]): PmcSeries {
  const ctlAtl = data.flatMap((d) => [d.ctl, d.atl]).filter((v): v is number => v != null);
  const tsbValues = data.map((d) => d.tsb).filter((v): v is number => v != null);
  const leftDomain = computeLeftDomain(ctlAtl);
  const rightDomain = computeRightDomain(tsbValues);

  const points = data.map((d) => {
    const tsb = d.tsb;
    return {
      ...d,
      tsbPositive: tsb != null ? Math.max(0, tsb) : null,
      tsbNegative: tsb != null ? Math.min(0, tsb) : null,
      tsbClassic: tsb != null ? mapToClassicScale(tsb, rightDomain, leftDomain) : null,
    };
  });

  return { points, leftDomain, rightDomain };
}
