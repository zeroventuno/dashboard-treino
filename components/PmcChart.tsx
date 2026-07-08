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

function PmcTooltip({ active, payload, label }: TooltipContentProps) {
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
        {fmtFullDate(String(label))}{projected ? " · projected" : ""}
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

  // strip shows real history only — including the projection tail would leave
  // a dead 14-day gap after the last recorded workout
  const realPoints = useMemo(() => points.filter((p) => p.ctl != null), [points]);

  // one tick per month: the first data point of each month present in the view
  const monthTicks = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const d of points) {
      const key = d.date.slice(0, 7);
      if (!seen.has(key)) { seen.add(key); out.push(d.date); }
    }
    return out;
  }, [points]);

  const hasNegative = yDomain[0] < 0;

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

      {/* main chart — one shared axis, real values for all three series */}
      <div className="h-56 w-full sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="ctlFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--lime)" stopOpacity={0.16} />
                <stop offset="100%" stopColor="var(--lime)" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="var(--border-soft)" vertical={false} />
            <XAxis dataKey="date" ticks={monthTicks} tickFormatter={monthLabel} tickLine={false} axisLine={false} />
            <YAxis domain={yDomain} tickLine={false} axisLine={false} width={44} />
            <Tooltip content={PmcTooltip} isAnimationActive={false} />

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
            {lastReal && shown.ctl && (
              <ReferenceDot x={lastReal.date} y={lastReal.ctl} r={4.5}
                fill="var(--lime)" stroke="var(--surface)" strokeWidth={2} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* daily training-load strip (Strava-style context row) */}
      <div className="mt-1 h-[44px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={realPoints} margin={{ top: 2, right: 8, left: -18, bottom: 0 }}>
            <XAxis dataKey="date" tick={false} tickLine={false} axisLine={false} height={1} />
            <YAxis domain={[0, maxTss]} hide width={44} />
            <Bar dataKey="tss" isAnimationActive={false} maxBarSize={4}>
              {realPoints.map((p) => (
                <Cell key={p.date} fill={p.isToday ? "var(--lime)" : "var(--text-faint)"} fillOpacity={p.isToday ? 1 : 0.45} />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1.5 text-[10.5px] text-[var(--text-faint)]">
        Daily training load below · dashed lines project the next 2 weeks with no training
      </p>
    </div>
  );
}
