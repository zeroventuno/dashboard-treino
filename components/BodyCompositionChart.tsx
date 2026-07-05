"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BodyComposition } from "@/lib/types";
import { fmtDayMonth } from "@/lib/utils";

type Key = "weight_kg" | "body_fat_pct" | "muscle_mass_kg" | "lean_mass_kg" | "visceral_fat" | "metabolic_age";

const METRICS: { key: Key; label: string; unit: string; color: string; decimals: number; lowerIsBetter: boolean }[] = [
  { key: "weight_kg",      label: "Weight",        unit: "kg", color: "var(--lime)",     decimals: 1, lowerIsBetter: true },
  { key: "body_fat_pct",   label: "Body fat",      unit: "%",  color: "var(--run)",      decimals: 1, lowerIsBetter: true },
  { key: "muscle_mass_kg", label: "Muscle",        unit: "kg", color: "var(--teal)",     decimals: 1, lowerIsBetter: false },
  { key: "lean_mass_kg",   label: "Lean mass",     unit: "kg", color: "var(--swim)",     decimals: 1, lowerIsBetter: false },
  { key: "visceral_fat",   label: "Visceral fat",  unit: "",   color: "var(--warn)",     decimals: 0, lowerIsBetter: true },
  { key: "metabolic_age",  label: "Metabolic age", unit: "yr", color: "var(--strength)", decimals: 0, lowerIsBetter: true },
];

export function BodyCompositionChart({ entries }: { entries: BodyComposition[] }) {
  const [sel, setSel] = useState<Key>("weight_kg");
  const active = METRICS.find((m) => m.key === sel)!;

  const stats = useMemo(() => {
    const out: Record<string, { current: number | null; delta: number | null }> = {};
    for (const m of METRICS) {
      const vals = entries.map((e) => e[m.key]).filter((v): v is number => v != null);
      const current = vals.length ? vals[vals.length - 1] : null;
      const delta = vals.length > 1 ? vals[vals.length - 1] - vals[0] : null;
      out[m.key] = { current, delta };
    }
    return out;
  }, [entries]);

  if (entries.length === 0) {
    return (
      <p className="text-[13px] text-[var(--text-faint)]">
        No body-composition data yet — send a bioimpedance photo in chat to start the chart.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2">
        {METRICS.map((m) => {
          const s = stats[m.key];
          const on = m.key === sel;
          const good = s.delta != null && (m.lowerIsBetter ? s.delta < 0 : s.delta > 0);
          const deltaColor = s.delta == null || s.delta === 0 ? "var(--text-faint)" : good ? "var(--good)" : "var(--bad)";
          return (
            <button
              key={m.key}
              onClick={() => setSel(m.key)}
              className="rounded-[12px] border px-3 py-2 text-left transition-colors"
              style={{
                borderColor: on ? m.color : "var(--border)",
                background: on ? "color-mix(in oklab, var(--surface-2) 100%, transparent)" : "transparent",
              }}
            >
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: m.color }} />
                <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-faint)]">{m.label}</span>
              </div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="dsp tnum text-[20px] font-extrabold leading-none" style={{ color: on ? m.color : "var(--text)" }}>
                  {s.current != null ? s.current.toFixed(m.decimals) : "—"}
                </span>
                <span className="text-[10px] text-[var(--text-faint)]">{m.unit}</span>
                {s.delta != null && s.delta !== 0 && (
                  <span className="tnum text-[10px] font-semibold" style={{ color: deltaColor }}>
                    {s.delta > 0 ? "▲" : "▼"} {Math.abs(s.delta).toFixed(m.decimals)}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <div className="h-52 w-full sm:h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={entries} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
            <CartesianGrid stroke="var(--border-soft)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={(iso) => fmtDayMonth(String(iso))} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis domain={["auto", "auto"]} tickLine={false} axisLine={false} width={42} />
            <Tooltip
              contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12, color: "var(--text)" }}
              labelFormatter={(l) => fmtDayMonth(String(l))}
              formatter={(value) => [`${Number(value).toFixed(active.decimals)}${active.unit}`, active.label]}
            />
            <Line type="monotone" dataKey={sel} stroke={active.color} strokeWidth={2.4} dot={{ r: 3, fill: active.color }} activeDot={{ r: 5 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
