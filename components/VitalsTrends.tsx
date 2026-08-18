"use client";

// Small multiples for the five daily check-in signals. See lib/vitals.ts for
// why gaps are drawn rather than smoothed over, and why nothing here judges a
// number. This file is the drawing half only.
//
// WHY SMALL MULTIPLES AND NOT ONE CHART WITH A SERIES PICKER (the BodyComposition
// idiom next door):
//   · the five series have five unrelated units — ms, hours, a 0-100 score,
//     a 0-100 score, bpm — so one shared axis is impossible, and lib/pmc is
//     explicit that this project does not do dual axes;
//   · the whole value of the block is reading the signals AGAINST each other.
//     "HRV drifting down while resting HR drifts up and sleep got shorter" is
//     one glance here and three clicks and a memory test behind a picker.
// Density comes from the panels being small — a 66-76px sparkline row, five
// across on a desktop, two across on a phone — not from hiding four of them.

import { useMemo, useState } from "react";
import {
  Bar, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type TooltipContentProps,
} from "recharts";
import type { Checkin } from "@/lib/types";
import type { Metric } from "@/lib/tenant-config";
import { RANGE_OPTIONS, type RangeKey } from "@/lib/pmc";
import {
  ROLLING_DAYS, prepareVitals, stableSeriesKeys,
  type VitalKey, type VitalPoint, type VitalSeriesData,
} from "@/lib/vitals";
import { DEFAULT_LOCALE, translator, type Locale, type T } from "@/lib/i18n";
import { fmtDayMonth, fmtFullDate, fmtSleepHours } from "@/lib/utils";

/** Three weeks of drift is the question this block was asked; 3M frames it with
 * enough before-and-after to answer it without scrolling a year. */
const DEFAULT_RANGE: RangeKey = "3m";

/** 5.63 hours reads as "5h38", never "5.6h" — the house rule from lib/utils. */
function fmtValue(key: VitalKey, v: number | null, decimals: number): string {
  if (v == null) return "—";
  if (key === "sleep_hours") return fmtSleepHours(v);
  return v.toFixed(decimals);
}
function unitOf(s: VitalSeriesData): string {
  return s.def.key === "sleep_hours" ? "" : s.def.unit;
}
function fmtDelta(key: VitalKey, d: number, decimals: number): string {
  const mag = key === "sleep_hours"
    ? `${Math.abs(d).toFixed(1)}h`
    : Math.abs(d).toFixed(decimals);
  return `${d > 0 ? "▲" : "▼"} ${mag}`;
}

function VitalTooltip({ active, payload, s, tr }: TooltipContentProps & { s: VitalSeriesData; tr: T }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as VitalPoint;
  const unit = unitOf(s);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 text-[11.5px] shadow-lg">
      <p className="mb-1 font-bold text-[var(--text-faint)]">{fmtFullDate(p.date)}</p>
      {p.value == null ? (
        // The honest branch: no reading is stated in words, not implied by a
        // blank number that could be misread as a zero.
        <p className="text-[var(--text-muted)]">{tr("vitals.noReading")}</p>
      ) : (
        <p className="tnum" style={{ color: s.def.color }}>
          {tr(s.def.labelKey)}:{" "}
          <span className="font-bold">{fmtValue(s.def.key, p.value, s.def.decimals)}</span>
          {unit && <span className="text-[var(--text-faint)]"> {unit}</span>}
        </p>
      )}
      {p.mean != null && (
        <p className="tnum mt-0.5 text-[var(--text-muted)]">
          {tr("vitals.rolling").replace("{d}", String(ROLLING_DAYS))}:{" "}
          <span className="font-semibold">{fmtValue(s.def.key, p.mean, s.def.decimals)}</span>
        </p>
      )}
    </div>
  );
}

function VitalPanel({ s, tr }: { s: VitalSeriesData; tr: T }) {
  const unit = unitOf(s);
  const label = tr(s.def.labelKey);
  const n = s.points.length;

  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.def.color }} />
        <span className="truncate text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-faint)]">
          {label}
        </span>
      </div>

      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5">
        <span className="dsp tnum text-[19px] font-extrabold leading-none" style={{ color: s.def.color }}>
          {fmtValue(s.def.key, s.latest?.value ?? null, s.def.decimals)}
        </span>
        {unit && <span className="text-[9.5px] text-[var(--text-faint)]">{unit}</span>}
        {s.delta != null && (
          // Direction only, in the neutral text colour. Deliberately NOT the
          // good/bad palette the body-composition chart uses: that chart knows
          // which way is better for weight, and nobody here gets to decide
          // which way is better for HRV.
          <span className="tnum text-[9.5px] font-semibold text-[var(--text-muted)]">
            {fmtDelta(s.def.key, s.delta, s.def.decimals)}
          </span>
        )}
      </div>

      {s.logged === 0 ? (
        // A window the athlete logged nothing in. Say that, in words, at the
        // size the chart would have been — an empty plot reads as broken.
        <div className="mt-1.5 flex h-[66px] items-center justify-center rounded-[10px] border border-dashed border-[var(--border)] px-2 text-center sm:h-[76px]">
          <span className="text-[10px] leading-tight text-[var(--text-faint)]">
            {tr("vitals.noReadingRange")}
          </span>
        </div>
      ) : (
        <div
          className="mt-1.5 h-[66px] w-full sm:h-[76px]"
          role="img"
          aria-label={`${label} — ${tr("vitals.missing").replace("{n}", String(s.missing))}`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={s.points} margin={{ top: 3, right: 3, left: 3, bottom: 0 }}>
              {/* An explicit NUMERIC index axis, not the date string: with a Bar
                  in the chart recharts would switch a category axis to a band
                  scale and the marks would drift off their day (the same trap
                  documented in PmcChart). It also guarantees a missing day
                  occupies its own width — the gap is real horizontal space. */}
              <XAxis dataKey="idx" type="number" domain={[0, n - 1]} hide />
              <YAxis yAxisId="v" domain={s.domain} hide />
              {/* Hidden companion axis: value 1 against a domain of 8 puts the
                  missing-day marks in the bottom eighth of the plot, on the one
                  shared x-axis, so they line up with their day by construction.
                  s.domain already reserves that band. */}
              <YAxis yAxisId="gap" domain={[0, 8]} hide />
              <Tooltip
                content={(props: TooltipContentProps) => <VitalTooltip {...props} s={s} tr={tr} />}
                cursor={{ stroke: "var(--text-faint)", strokeOpacity: 0.35 }}
                isAnimationActive={false}
              />

              {/* the athlete's own mean over the window — a reference, not a target */}
              {s.mean != null && (
                <ReferenceLine yAxisId="v" y={s.mean} stroke="var(--text-faint)"
                  strokeDasharray="2 3" strokeWidth={1} strokeOpacity={0.8} />
              )}

              {/* every day with NO reading gets a mark of its own */}
              <Bar yAxisId="gap" dataKey="gap" fill="var(--text-faint)" fillOpacity={0.5}
                maxBarSize={3} isAnimationActive={false} />

              {/* the readings themselves: dots, never joined. A day without a
                  reading has no dot, and there is no segment bridging it. */}
              <Line yAxisId="v" dataKey="value" stroke="none" isAnimationActive={false}
                dot={{ r: 1.5, fill: s.def.color, fillOpacity: 0.75, stroke: "none" }}
                activeDot={{ r: 3.5, fill: s.def.color, stroke: "var(--surface-2)", strokeWidth: 1.5 }} />

              {/* the trend. connectNulls stays OFF: lib/vitals nulls the mean
                  wherever the trailing window is too empty to average, and the
                  line has to actually break there. */}
              <Line yAxisId="v" dataKey="mean" stroke={s.def.color} strokeWidth={1.7}
                dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <p className="tnum mt-1 text-[9.5px] leading-tight text-[var(--text-faint)]">
        {s.min != null && s.max != null && (
          <>
            {fmtValue(s.def.key, s.min, s.def.decimals)}–{fmtValue(s.def.key, s.max, s.def.decimals)}
            {unit ? ` ${unit}` : ""} ·{" "}
          </>
        )}
        {s.missing === 0
          ? tr("vitals.complete")
          : tr("vitals.missing").replace("{n}", String(s.missing))}
      </p>
    </div>
  );
}

export function VitalsTrends({
  checkins, metrics, todayISO, locale = DEFAULT_LOCALE,
}: {
  checkins: Checkin[];
  metrics: Metric[];
  todayISO: string;
  locale?: Locale;
}) {
  const tr = translator(locale);
  const [range, setRange] = useState<RangeKey>(DEFAULT_RANGE);
  const rangeDays = RANGE_OPTIONS.find((r) => r.key === range)!.days;

  // Fixed by the widest window, so flipping 6M → 1M never reshuffles the grid
  // under the athlete's finger.
  const keys = useMemo(() => stableSeriesKeys(checkins, metrics, todayISO), [checkins, metrics, todayISO]);
  const win = useMemo(
    () => prepareVitals(checkins, metrics, rangeDays, todayISO, keys),
    [checkins, metrics, rangeDays, todayISO, keys],
  );

  if (win.series.length === 0) return null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="tnum text-[11px] text-[var(--text-faint)]">
          {fmtDayMonth(win.startISO)} – {fmtDayMonth(win.endISO)} · {win.days}d
        </p>
        {/* Same vocabulary as the fitness chart (RANGE_OPTIONS, lib/pmc) — one
            range control in the product, not two that disagree. */}
        <div className="flex shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5 text-[11px] font-semibold">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className="rounded-full px-3 py-1 transition-colors"
              aria-pressed={range === r.key}
              style={{
                background: range === r.key ? "var(--lime)" : "transparent",
                color: range === r.key ? "#0a0b0d" : "var(--text-muted)",
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Two across on a phone, three on a tablet, all five in one row on a
          desktop. An odd panel count leaves the last one alone in its row at
          two columns, so it takes the full width there instead of sitting in a
          half-empty row — reset from `sm` up, where the row is already full. */}
      <div className="grid grid-cols-2 gap-2.5 [&>:last-child:nth-child(odd)]:col-span-2 sm:grid-cols-3 sm:[&>:last-child:nth-child(odd)]:col-span-1 xl:grid-cols-5">
        {win.series.map((s) => (
          <VitalPanel key={s.def.key} s={s} tr={tr} />
        ))}
      </div>

      <p className="mt-2.5 text-[10.5px] leading-relaxed text-[var(--text-faint)]">
        {tr("vitals.note").replace("{d}", String(ROLLING_DAYS))}
      </p>
    </div>
  );
}
