"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TrainingLoad } from "@/lib/types";

const SERIES = [
  { key: "ctl", label: "FITNESS · CTL", color: "var(--lime)", line: "var(--lime)" },
  { key: "atl", label: "FATIGUE · ATL", color: "#9aa0a8", line: "#7d838c" },
  { key: "tsb", label: "FORM · TSB", color: "var(--teal)", line: "var(--teal)" },
] as const;

type Key = (typeof SERIES)[number]["key"];

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthTick(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  return d <= 6 ? MON[m - 1].toUpperCase() : "";
}
function fullTick(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MON[m - 1]}`;
}

export function PmcChart({ data }: { data: TrainingLoad[] }) {
  const [shown, setShown] = useState<Record<Key, boolean>>({ ctl: true, atl: true, tsb: true });
  const last = data[data.length - 1];
  const view = useMemo(() => data.slice(-168), [data]); // up to 24 weeks

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-x-8 gap-y-3">
        {SERIES.map((s) => (
          <button
            key={s.key}
            onClick={() => setShown((p) => ({ ...p, [s.key]: !p[s.key] }))}
            className="text-left transition-opacity"
            style={{ opacity: shown[s.key] ? 1 : 0.4 }}
          >
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">{s.label}</span>
            </div>
            <div className="dsp tnum mt-0.5 text-[32px] font-extrabold leading-none" style={{ color: s.color }}>
              {last ? Math.round(Number(last[s.key] ?? 0)) : "—"}
            </div>
          </button>
        ))}
      </div>

      <div className="h-56 w-full sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={view} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="ctlFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--lime)" stopOpacity={0.2} />
                <stop offset="100%" stopColor="var(--lime)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border-soft)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={monthTick} interval={0} tickLine={false} axisLine={false} minTickGap={0} />
            <YAxis tickLine={false} axisLine={false} width={44} />
            <Tooltip
              contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12, color: "var(--text)" }}
              labelFormatter={(l) => fullTick(String(l))}
              formatter={(value, name) => [Math.round(Number(value)), String(name).toUpperCase()]}
            />
            {shown.ctl && <Area type="monotone" dataKey="ctl" stroke="var(--lime)" strokeWidth={2.4} fill="url(#ctlFill)" dot={false} activeDot={{ r: 4 }} />}
            {shown.atl && <Line type="monotone" dataKey="atl" stroke="#7d838c" strokeWidth={1.8} dot={false} activeDot={{ r: 4 }} />}
            {shown.tsb && <Line type="monotone" dataKey="tsb" stroke="var(--teal)" strokeWidth={1.8} dot={false} activeDot={{ r: 4 }} />}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
