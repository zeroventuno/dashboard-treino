"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area, Brush, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps,
} from "recharts";
import type { TrainingLoad } from "@/lib/types";
import { fmtFullDate } from "@/lib/utils";
import { preparePmcSeries, TSB_ZONES, zoneFor, type PmcMode, type PmcPoint } from "@/lib/pmc";

const METRICS = [
  { key: "ctl", label: "FITNESS · CTL", color: "var(--lime)" },
  { key: "atl", label: "FATIGUE · ATL", color: "#9aa0a8" },
  { key: "tsb", label: "FORM · TSB", color: "var(--teal)" },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(iso: string) {
  return MON[Number(iso.split("-")[1]) - 1].toUpperCase();
}
function fmtSigned(n: number): string {
  return `${n > 0 ? "+" : ""}${Math.round(n)}`;
}

/** True under `breakpoint`px — used to drop the form zones on small screens. */
function useIsMobile(breakpoint = 640): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpoint]);
  return isMobile;
}

/** Always reads the real underlying data point, so Form shows its true value
 * (and zone) even while the chart is in the compressed "classic" overlay mode. */
function PmcTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload as PmcPoint;
  const zone = point.tsb != null ? zoneFor(point.tsb) : null;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 text-[12px] shadow-lg">
      <p className="mb-1.5 font-bold text-[var(--text-faint)]">{fmtFullDate(String(label))}</p>
      <p className="tnum" style={{ color: "var(--lime)" }}>
        Fitness: <span className="font-bold">{point.ctl != null ? Math.round(point.ctl) : "—"}</span>
      </p>
      <p className="tnum" style={{ color: "#9aa0a8" }}>
        Fatigue: <span className="font-bold">{point.atl != null ? Math.round(point.atl) : "—"}</span>
      </p>
      <p className="tnum" style={{ color: "var(--teal)" }}>
        Form: <span className="font-bold">{point.tsb != null ? fmtSigned(point.tsb) : "—"}</span>
        {zone && <span className="text-[var(--text-faint)]"> · {zone.label}</span>}
      </p>
    </div>
  );
}

export function PmcChart({ data }: { data: TrainingLoad[] }) {
  const [shown, setShown] = useState<Record<MetricKey, boolean>>({ ctl: true, atl: true, tsb: true });
  const [mode, setMode] = useState<PmcMode>("real");
  const isMobile = useIsMobile();

  const view = useMemo(() => data.slice(-168), [data]); // up to 24 weeks
  const { points, leftDomain, rightDomain } = useMemo(() => preparePmcSeries(view), [view]);
  const last = points[points.length - 1];

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

  const showZones = mode === "real" && shown.tsb && !isMobile;

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
            >
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} />
                <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">{m.label}</span>
              </div>
              <div className="dsp tnum mt-0.5 text-[32px] font-extrabold leading-none" style={{ color: m.color }}>
                {last ? (m.key === "tsb" ? (last.tsb != null ? fmtSigned(last.tsb) : "—") : Math.round(Number(last[m.key] ?? 0))) : "—"}
              </div>
              {m.key === "tsb" && (
                <p className="mt-0.5 text-[9px] uppercase tracking-wide text-[var(--text-faint)]">
                  {mode === "real" ? "Right axis" : "Classic overlay"}
                </p>
              )}
            </button>
          ))}
        </div>

        {/* Real (dual-axis, true values) vs Classic (TrainingPeaks-style overlay) */}
        <div className="flex shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-2)] p-0.5 text-[11px] font-semibold">
          {(["real", "classic"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="rounded-full px-3 py-1.5 capitalize transition-colors"
              style={{ background: mode === m ? "var(--lime)" : "transparent", color: mode === m ? "#0a0b0d" : "var(--text-muted)" }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="h-56 w-full sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="ctlFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--lime)" stopOpacity={0.2} />
                <stop offset="100%" stopColor="var(--lime)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="tsbPosFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--good)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--good)" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="tsbNegFill" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#6b8cae" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#6b8cae" stopOpacity={0.05} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke="var(--border-soft)" vertical={false} />
            <XAxis dataKey="date" ticks={monthTicks} tickFormatter={monthLabel} tickLine={false} axisLine={false} />
            <YAxis yAxisId="left" domain={leftDomain} tickLine={false} axisLine={false} width={44} />
            {mode === "real" && (
              <YAxis
                yAxisId="right" orientation="right" domain={rightDomain}
                tickLine={false} axisLine={false} width={40}
                tickFormatter={(v) => fmtSigned(Number(v))}
              />
            )}

            {showZones && TSB_ZONES.map((z) => (
              <ReferenceArea
                key={z.key} yAxisId="right"
                y1={Number.isFinite(z.min) ? z.min : rightDomain[0]}
                y2={Number.isFinite(z.max) ? z.max : rightDomain[1]}
                fill={z.color} fillOpacity={0.07} strokeWidth={0}
              />
            ))}

            <Tooltip content={PmcTooltip} />

            {shown.ctl && (
              <Area yAxisId="left" type="monotone" dataKey="ctl" stroke="var(--lime)" strokeWidth={2.4}
                fill="url(#ctlFill)" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            )}
            {shown.atl && (
              <Line yAxisId="left" type="monotone" dataKey="atl" stroke="#7d838c" strokeWidth={1.8}
                dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            )}

            {shown.tsb && mode === "real" && (
              <>
                <ReferenceLine yAxisId="right" y={0} stroke="var(--text-faint)" strokeWidth={1.4} strokeDasharray="3 3" />
                <Area yAxisId="right" type="monotone" dataKey="tsbPositive" stroke="var(--good)" strokeWidth={1.8}
                  fill="url(#tsbPosFill)" baseValue={0} dot={false} activeDot={false} isAnimationActive={false} />
                <Area yAxisId="right" type="monotone" dataKey="tsbNegative" stroke="#6b8cae" strokeWidth={1.8}
                  fill="url(#tsbNegFill)" baseValue={0} dot={false} activeDot={false} isAnimationActive={false} />
              </>
            )}
            {shown.tsb && mode === "classic" && (
              <>
                <ReferenceLine yAxisId="left" y={leftDomain[1] / 2} stroke="var(--text-faint)" strokeWidth={1.4} strokeDasharray="3 3" />
                <Line yAxisId="left" type="monotone" dataKey="tsbClassic" stroke="var(--teal)" strokeWidth={1.8}
                  strokeDasharray="4 3" dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
              </>
            )}

            <Brush dataKey="date" height={20} stroke="var(--border)" fill="var(--bg-soft)" travellerWidth={8} tickFormatter={() => ""} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {mode === "classic" && (
        <p className="mt-2 text-[10.5px] text-[var(--text-faint)]">
          Escala clássica: Form comprimido no mesmo eixo de Fitness/Fatigue (como no TrainingPeaks) — passe o mouse para ver o valor real.
        </p>
      )}
    </div>
  );
}
