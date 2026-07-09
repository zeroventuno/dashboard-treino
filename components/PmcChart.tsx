"use client";

import { useMemo, useState } from "react";
import {
  Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, type TooltipContentProps,
} from "recharts";
import type { TrainingLoad } from "@/lib/types";
import { fmtFullDate } from "@/lib/utils";
import { preparePmcSeries, zoneFor, RANGE_OPTIONS, type RangeKey, type PmcPoint } from "@/lib/pmc";

// Fixed series order & colors (brand palette; CVD-checked: worst adjacent pair
// ΔE 21.8 deutan, all ≥3:1 on the card surface). Identity is reinforced by the
// labeled metric chips + tooltip, never color alone.
const METRICS = [
  { key: "ctl", label: "FITNESS", color: "var(--lime)" },
  { key: "atl", label: "FATIGUE", color: "#9aa0a8" },
  { key: "tsb", label: "FORM", color: "var(--teal)" },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(iso: string) {
  return MON[Number(iso.split("-")[1]) - 1].toUpperCase();
}
function fmtSigned(n: number): string {
  return `${n > 0 ? "+" : ""}${Math.round(n)}`;
}

function PmcTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as PmcPoint;
  const projected = p.ctl == null && p.ctlProj != null;
  const ctl = p.ctl ?? p.ctlProj;
  const atl = p.atl ?? p.atlProj;
  const tsb = p.tsb ?? p.tsbProj;
  const zone = tsb != null ? zoneFor(tsb) : null;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-[12px] shadow-lg">
      <p className="mb-1.5 font-bold text-[var(--text-faint)]">
        {fmtFullDate(p.date)}{projected ? " · projected" : ""}
      </p>
      <p className="tnum" style={{ color: "var(--lime)" }}>
        Fitness: <span className="font-bold">{ctl != null ? Math.round(ctl) : "—"}</span>
      </p>
      <p className="tnum" style={{ color: "#9aa0a8" }}>
        Fatigue: <span className="font-bold">{atl != null ? Math.round(atl) : "—"}</span>
      </p>
      <p className="tnum" style={{ color: "var(--teal)" }}>
        Form: <span className="font-bold">{tsb != null ? fmtSigned(tsb) : "—"}</span>
        {zone && <span className="text-[var(--text-faint)]"> · {zone.label}</span>}
      </p>
      {p.tss != null && p.tss > 0 && (
        <p className="tnum mt-1 border-t border-[var(--border)] pt-1 text-[var(--text-muted)]">
          Load: <span className="font-bold">{Math.round(p.tss)}</span>
        </p>
      )}
    </div>
  );
}

export function PmcChart({ data }: { data: TrainingLoad[] }) {
  const [shown, setShown] = useState<Record<MetricKey, boolean>>({ ctl: true, atl: true, tsb: true });
  const [range, setRange] = useState<RangeKey>("6m");

  const rangeDays = RANGE_OPTIONS.find((r) => r.key === range)!.days;
  const { points, yDomain, maxTss, lastReal } = useMemo(
    () => preparePmcSeries(data, rangeDays),
    [data, rangeDays],
  );

  // Both charts render in separate <ComposedChart> instances (one for the
  // Line/Area, one for the Bar strip below). Recharts auto-picks a "point"
  // scale for a category axis with no Bar, but a "band" scale when a Bar is
  // present — two different padding formulas, so a shared string dataKey
  // drifts out of alignment over a long range. An explicit numeric index
  // axis (same domain, same length, in both charts) sidesteps that entirely:
  // linear scale math is identical regardless of which series use it.
  const idxPoints = useMemo(() => points.map((p, i) => ({ ...p, idx: i })), [points]);

  // rest days have real tss=0, which Recharts draws as an invisible 0px bar —
  // leaving gaps that read as missing days. `tssBar` gives every real day a
  // small visible floor while `tss` (used by the tooltip) stays untouched, so
  // the "Load" number shown on hover is never faked.
  const barPoints = useMemo(() => {
    const floor = maxTss * 0.035;
    return idxPoints.map((p) => ({ ...p, tssBar: p.tss != null ? Math.max(p.tss, floor) : null }));
  }, [idxPoints, maxTss]);

  // one tick per month: the index of the first data point of each month
  const monthTicks = useMemo(() => {
    const seen = new Set<string>();
    const out: number[] = [];
    for (const d of idxPoints) {
      const key = d.date.slice(0, 7);
      if (!seen.has(key)) { seen.add(key); out.push(d.idx); }
    }
    return out;
  }, [idxPoints]);

  // last real (non-projected) point's index — for the "today" ReferenceDot
  const lastRealIdx = useMemo(() => {
    for (let i = idxPoints.length - 1; i >= 0; i--) if (idxPoints[i].ctl != null) return i;
    return null;
  }, [idxPoints]);

  const hasNegative = yDomain[0] < 0;

  // The daily-load bars share this same chart (not a separate synced
  // instance — two independently-scaled Recharts containers drift apart
  // over a long range, no matter how carefully the axes are matched). A
  // hidden secondary y-axis maps maxTss to ~18% of the plot height, so bars
  // read as a short strip hugging the bottom — same visual as before, but
  // pixel-perfect under the dates above by construction, since it's one
  // shared x-axis. The axis is never shown; exact values stay in the tooltip.
  const loadAxisMax = maxTss / 0.18;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setShown((p) => ({ ...p, [m.key]: !p[m.key] }))}
              className="text-left transition-opacity"
              style={{ opacity: shown[m.key] ? 1 : 0.4 }}
              aria-pressed={shown[m.key]}
            >
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />
                <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">{m.label}</span>
              </div>
              <div className="dsp tnum mt-0.5 text-[32px] font-extrabold leading-none" style={{ color: m.color }}>
                {lastReal ? (m.key === "tsb" ? fmtSigned(lastReal.tsb) : Math.round(lastReal[m.key])) : "—"}
              </div>
            </button>
          ))}
        </div>

        <div className="flex shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5 text-[11px] font-semibold">
          {RANGE_OPTIONS.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className="rounded-full px-3 py-1.5 transition-colors"
              style={{ background: range === r.key ? "var(--lime)" : "transparent", color: range === r.key ? "#0a0b0d" : "var(--text-muted)" }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* one chart: Fitness/Fatigue/Form on the primary axis, daily load bars
          on a hidden secondary axis mapped to the bottom ~18% of the plot.
          Single shared x-axis means the bars are pixel-perfect under their
          date by construction — no cross-chart scale drift to fight. */}
      <div className="h-64 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={barPoints} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="ctlFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--lime)" stopOpacity={0.16} />
                <stop offset="100%" stopColor="var(--lime)" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="var(--border-soft)" vertical={false} />
            <XAxis dataKey="idx" type="number" domain={[0, idxPoints.length - 1]}
              ticks={monthTicks} tickFormatter={(v) => monthLabel(idxPoints[v]?.date ?? "")}
              tickLine={false} axisLine={false} />
            <YAxis domain={yDomain} tickLine={false} axisLine={false} width={44} />
            <YAxis yAxisId="load" domain={[0, loadAxisMax]} hide />
            <Tooltip content={PmcTooltip} cursor={{ fill: "var(--surface-3)", opacity: 0.15 }} isAnimationActive={false} />

            {/* daily load bars — bottom strip via the hidden secondary axis */}
            <Bar yAxisId="load" dataKey="tssBar" isAnimationActive={false} maxBarSize={4}>
              {barPoints.map((p) => (
                <Cell key={p.date} fill={p.isToday ? "var(--lime)" : "var(--text-faint)"} fillOpacity={p.isToday ? 1 : 0.4} />
              ))}
            </Bar>

            {/* zero baseline — only meaningful when Form dips below it */}
            {hasNegative && (
              <ReferenceLine y={0} stroke="var(--text-faint)" strokeWidth={1.2} strokeDasharray="3 3" />
            )}

            {/* solid history */}
            {shown.ctl && (
              <Area type="monotone" dataKey="ctl" stroke="var(--lime)" strokeWidth={2.2}
                fill="url(#ctlFill)" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            )}
            {shown.atl && (
              <Line type="monotone" dataKey="atl" stroke="#7d838c" strokeWidth={1.6}
                dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            )}
            {shown.tsb && (
              <Line type="monotone" dataKey="tsb" stroke="var(--teal)" strokeWidth={1.8}
                dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            )}

            {/* dashed decay projection (no further training) */}
            {shown.ctl && (
              <Line type="monotone" dataKey="ctlProj" stroke="var(--lime)" strokeWidth={1.6}
                strokeDasharray="4 4" strokeOpacity={0.7} dot={false} activeDot={false} isAnimationActive={false} />
            )}
            {shown.atl && (
              <Line type="monotone" dataKey="atlProj" stroke="#7d838c" strokeWidth={1.4}
                strokeDasharray="4 4" strokeOpacity={0.7} dot={false} activeDot={false} isAnimationActive={false} />
            )}
            {shown.tsb && (
              <Line type="monotone" dataKey="tsbProj" stroke="var(--teal)" strokeWidth={1.4}
                strokeDasharray="4 4" strokeOpacity={0.7} dot={false} activeDot={false} isAnimationActive={false} />
            )}

            {/* today: dot on the end of the solid Fitness line (Strava-style) */}
            {lastReal && lastRealIdx != null && shown.ctl && (
              <ReferenceDot x={lastRealIdx} y={lastReal.ctl} r={4.5}
                fill="var(--lime)" stroke="var(--surface)" strokeWidth={2} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1.5 text-[10.5px] text-[var(--text-faint)]">
        Daily training load below · dashed lines project the next 2 weeks with no training
      </p>
    </div>
  );
}
