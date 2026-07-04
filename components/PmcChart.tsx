"use client";

import { useMemo, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { TrainingLoad } from "@/lib/types";

const SERIES = [
  { key: "ctl", label: "CTL", desc: "Fitness", color: "var(--surge)" },
  { key: "atl", label: "ATL", desc: "Fadiga", color: "var(--run)" },
  { key: "tsb", label: "TSB", desc: "Forma", color: "var(--azure)" },
] as const;

type Key = (typeof SERIES)[number]["key"];

function fmtTick(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

export function PmcChart({ data }: { data: TrainingLoad[] }) {
  const [shown, setShown] = useState<Record<Key, boolean>>({ ctl: true, atl: true, tsb: true });
  const last = data[data.length - 1];

  // show ~last 90 days for readability
  const view = useMemo(() => data.slice(-90), [data]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-6">
          {SERIES.map((s) => (
            <button
              key={s.key}
              onClick={() => setShown((p) => ({ ...p, [s.key]: !p[s.key] }))}
              className="group text-left transition-opacity"
              style={{ opacity: shown[s.key] ? 1 : 0.4 }}
            >
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                  {s.label} · {s.desc}
                </span>
              </div>
              <div className="tnum mt-0.5 text-3xl font-bold" style={{ color: s.color }}>
                {last ? Math.round(Number(last[s.key] ?? 0)) : "—"}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="h-56 w-full sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={view} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="ctlFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--surge)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--surge)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border-soft)" vertical={false} />
            <XAxis
              dataKey="date" tickFormatter={fmtTick} minTickGap={40}
              tickLine={false} axisLine={false}
            />
            <YAxis tickLine={false} axisLine={false} width={44} />
            <Tooltip
              contentStyle={{
                background: "var(--surface-2)", border: "1px solid var(--border)",
                borderRadius: 12, fontSize: 12, color: "var(--text)",
              }}
              labelFormatter={(l) => fmtTick(String(l))}
              formatter={(value, name) => [Math.round(Number(value)), String(name).toUpperCase()]}
            />
            {shown.ctl && (
              <Area type="monotone" dataKey="ctl" stroke="var(--surge)" strokeWidth={2.4}
                fill="url(#ctlFill)" dot={false} activeDot={{ r: 4 }} />
            )}
            {shown.atl && (
              <Line type="monotone" dataKey="atl" stroke="var(--run)" strokeWidth={2}
                dot={false} activeDot={{ r: 4 }} />
            )}
            {shown.tsb && (
              <Line type="monotone" dataKey="tsb" stroke="var(--azure)" strokeWidth={2}
                strokeDasharray="4 3" dot={false} activeDot={{ r: 4 }} />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
