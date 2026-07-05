"use client";

import { useState } from "react";
import type { MuscleGroup, StrengthSession } from "@/lib/types";
import { muscleUsage } from "@/lib/utils";

const LABELS: Record<MuscleGroup, string> = {
  quadriceps: "Quads", glutes: "Glutes", hamstrings: "Hamstrings",
  core: "Core", shoulders: "Shoulders", back: "Back", calves: "Calves",
  chest: "Chest", biceps: "Biceps", triceps: "Triceps",
};

function fill(count: number, max: number) {
  if (count <= 0) return "var(--surface-2)";
  const t = max > 0 ? count / max : 0;
  const pct = Math.round(20 + t * 70); // 20%..90% surge mix
  return `color-mix(in oklab, var(--surge) ${pct}%, var(--surface-2))`;
}

export function BodyMap({ sessions }: { sessions: StrengthSession[] }) {
  const usage = muscleUsage(sessions, 7);
  const max = Math.max(1, ...Object.values(usage));
  const [hover, setHover] = useState<MuscleGroup | null>(null);

  const props = (g: MuscleGroup) => ({
    fill: fill(usage[g] ?? 0, max),
    stroke: hover === g ? "var(--surge)" : "var(--border)",
    strokeWidth: hover === g ? 1.4 : 0.8,
    onMouseEnter: () => setHover(g),
    onMouseLeave: () => setHover(null),
    style: { cursor: "pointer", transition: "all .15s" },
  });

  const worked = (Object.keys(usage) as MuscleGroup[]).sort((a, b) => (usage[b] ?? 0) - (usage[a] ?? 0));

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {/* FRONT */}
        <figure className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-soft)] p-2">
          <svg viewBox="0 0 120 240" className="mx-auto h-52 w-auto">
            {/* silhouette */}
            <path d="M60 8a12 12 0 0 1 12 12c0 5-2 8-4 10 6 2 12 6 13 14l4 26c1 6-6 8-8 2l-3-16v0l-2 40 3 46c1 7-9 8-10 1l-5-40-5 40c-1 7-11 6-10-1l3-46-2-40-3 16c-2 6-9 4-8-2l4-26c1-8 7-12 13-14-2-2-4-5-4-10A12 12 0 0 1 60 8Z"
              fill="var(--surface)" stroke="var(--border-soft)" strokeWidth="1" />
            {/* shoulders */}
            <ellipse cx="40" cy="50" rx="7" ry="6" {...props("shoulders")} />
            <ellipse cx="80" cy="50" rx="7" ry="6" {...props("shoulders")} />
            {/* chest */}
            <path d="M50 56c-6 0-9 3-9 9 0 4 4 6 9 6 3 0 4-2 4-5v-6c0-2-1-4-4-4Z" {...props("chest")} />
            <path d="M70 56c6 0 9 3 9 9 0 4-4 6-9 6-3 0-4-2-4-5v-6c0-2 1-4 4-4Z" {...props("chest")} />
            {/* biceps */}
            <ellipse cx="33" cy="70" rx="4.5" ry="9" {...props("biceps")} />
            <ellipse cx="87" cy="70" rx="4.5" ry="9" {...props("biceps")} />
            {/* core */}
            <rect x="52" y="74" width="16" height="30" rx="6" {...props("core")} />
            {/* quads */}
            <path d="M52 118c-4 0-6 3-6 8l2 30c0 5 8 5 8 0l2-30c0-5-2-8-6-8Z" {...props("quadriceps")} />
            <path d="M68 118c4 0 6 3 6 8l-2 30c0 5-8 5-8 0l-2-30c0-5 2-8 6-8Z" {...props("quadriceps")} />
            {/* calves (shin) */}
            <ellipse cx="51" cy="192" rx="4" ry="12" {...props("calves")} />
            <ellipse cx="69" cy="192" rx="4" ry="12" {...props("calves")} />
          </svg>
          <figcaption className="mt-1 text-center text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Front</figcaption>
        </figure>

        {/* BACK */}
        <figure className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-soft)] p-2">
          <svg viewBox="0 0 120 240" className="mx-auto h-52 w-auto">
            <path d="M60 8a12 12 0 0 1 12 12c0 5-2 8-4 10 6 2 12 6 13 14l4 26c1 6-6 8-8 2l-3-16v0l-2 40 3 46c1 7-9 8-10 1l-5-40-5 40c-1 7-11 6-10-1l3-46-2-40-3 16c-2 6-9 4-8-2l4-26c1-8 7-12 13-14-2-2-4-5-4-10A12 12 0 0 1 60 8Z"
              fill="var(--surface)" stroke="var(--border-soft)" strokeWidth="1" />
            {/* rear shoulders / traps */}
            <ellipse cx="40" cy="50" rx="7" ry="6" {...props("shoulders")} />
            <ellipse cx="80" cy="50" rx="7" ry="6" {...props("shoulders")} />
            {/* back (lats) */}
            <path d="M50 56c-8 1-9 6-8 12l2 12c0 4 5 5 8 3v-22c0-3-1-5-2-5Zm20 0c8 1 9 6 8 12l-2 12c0 4-5 5-8 3v-22c0-3 1-5 2-5Z" {...props("back")} />
            {/* triceps */}
            <ellipse cx="33" cy="70" rx="4.5" ry="9" {...props("triceps")} />
            <ellipse cx="87" cy="70" rx="4.5" ry="9" {...props("triceps")} />
            {/* glutes */}
            <path d="M60 100c-8 0-13 4-13 11 0 6 5 9 13 9s13-3 13-9c0-7-5-11-13-11Z" {...props("glutes")} />
            {/* hamstrings */}
            <path d="M52 124c-4 0-6 3-6 8l2 28c0 5 8 5 8 0l2-28c0-5-2-8-6-8Z" {...props("hamstrings")} />
            <path d="M68 124c4 0 6 3 6 8l-2 28c0 5-8 5-8 0l-2-28c0-5 2-8 6-8Z" {...props("hamstrings")} />
            {/* calves */}
            <ellipse cx="51" cy="192" rx="4.5" ry="13" {...props("calves")} />
            <ellipse cx="69" cy="192" rx="4.5" ry="13" {...props("calves")} />
          </svg>
          <figcaption className="mt-1 text-center text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Back</figcaption>
        </figure>
      </div>

      {/* legend / summary */}
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-faint)]">
          <span>Less</span>
          <span className="h-2 w-5 rounded" style={{ background: fill(0, max) }} />
          <span className="h-2 w-5 rounded" style={{ background: fill(1, 2) }} />
          <span className="h-2 w-5 rounded" style={{ background: fill(2, 2) }} />
          <span>More · 7 days</span>
        </div>
        <span className="tnum text-[11px] text-[var(--text-muted)]">
          {hover ? `${LABELS[hover]}: ${usage[hover] ?? 0}×` : `${worked.length} groups`}
        </span>
      </div>

      {worked.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {worked.slice(0, 6).map((g) => (
            <span key={g} className="tnum rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
              {LABELS[g]} · {usage[g]}×
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
