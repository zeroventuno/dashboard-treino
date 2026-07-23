"use client";

import { useState } from "react";
import Body, { type ExtendedBodyPart, type Slug } from "react-muscle-highlighter";
import type { MuscleGroup, StrengthSession } from "@/lib/types";
import { muscleUsage } from "@/lib/utils";

// ────────────────────────────────────────────────────────────────────────────
//  Anatomy from react-muscle-highlighter (MIT, © 2024 My Muscle Contributors).
//
//  A dependency rather than copied path data: the drawing stays with the people
//  who maintain it, and nothing of theirs sits in this public repo. Two earlier
//  attempts failed — hand-authored ellipses, then a generated SVG whose whole
//  body was one continuous path with the arms as outward sweeps.
//
//  Only the artwork is theirs. The heat scale, the legend and the 7-day window
//  are ours, so the block keeps reading the same as the rest of the dashboard.
// ────────────────────────────────────────────────────────────────────────────

/** Our 10 tracked groups → their slugs. Several map to more than one: the coach
 * logs "core", the drawing separates abs from obliques. Splitting our model to
 * match would push that distinction onto the coach for no benefit. */
const SLUGS: Record<MuscleGroup, Slug[]> = {
  chest: ["chest"],
  shoulders: ["deltoids"],
  biceps: ["biceps"],
  triceps: ["triceps"],
  core: ["abs", "obliques"],
  back: ["upper-back", "lower-back", "trapezius"],
  glutes: ["gluteal"],
  hamstrings: ["hamstring"],
  quadriceps: ["quadriceps"],
  calves: ["calves"],
};

const LABELS: Record<MuscleGroup, string> = {
  quadriceps: "Quads", glutes: "Glutes", hamstrings: "Hamstrings",
  core: "Core", shoulders: "Shoulders", back: "Back", calves: "Calves",
  chest: "Chest", biceps: "Biceps", triceps: "Triceps",
};

// Heat is deliberately NOT var(--surge): that variable turns orange on a
// yellow-readiness day, which would repaint the muscle map for a reason that
// has nothing to do with muscles. A heatmap should mean one thing.
const HEAT = ["#8a5a24", "#c47a25", "#f0932b", "#ff9f32"] as const;
const REST_FILL = "#252b33";
const REST_STROKE = "#4a515b";

/** usage → 1..HEAT.length, which the library reads as colors[intensity - 1]. */
function intensityOf(count: number, max: number): number {
  const t = max > 0 ? Math.min(1, count / max) : 1;
  return Math.max(1, Math.ceil(t * HEAT.length));
}

export function BodyMap({ sessions }: { sessions: StrengthSession[] }) {
  const usage = muscleUsage(sessions, 7);
  const max = Math.max(1, ...Object.values(usage));
  const [picked, setPicked] = useState<MuscleGroup | null>(null);

  const worked = (Object.keys(usage) as MuscleGroup[])
    .filter((g) => (usage[g] ?? 0) > 0)
    .sort((a, b) => (usage[b] ?? 0) - (usage[a] ?? 0));

  // One entry per slug, so a group covering several slugs lights them together.
  const data: ExtendedBodyPart[] = worked.flatMap((g) =>
    SLUGS[g].map((slug) => ({ slug, intensity: intensityOf(usage[g] ?? 0, max) })),
  );

  const slugToGroup = (slug?: string): MuscleGroup | null =>
    (Object.keys(SLUGS) as MuscleGroup[]).find((g) => SLUGS[g].includes(slug as Slug)) ?? null;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {(["front", "back"] as const).map((side) => (
          <figure key={side} className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-soft)] p-2">
            <div className="flex h-64 items-center justify-center sm:h-72">
              <Body
                side={side}
                gender="male"
                data={data}
                colors={HEAT}
                scale={0.85}
                border="none"
                defaultFill={REST_FILL}
                defaultStroke={REST_STROKE}
                defaultStrokeWidth={0.6}
                // Press, not hover: the same gesture works on a phone, which is
                // where an athlete actually checks this between sessions.
                onBodyPartPress={(p) => setPicked((cur) => {
                  const g = slugToGroup(p.slug);
                  return cur === g ? null : g;
                })}
              />
            </div>
            <figcaption className="mt-1 text-center text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
              {side === "front" ? "Front" : "Back"}
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-faint)]">
          <span>Less</span>
          <span className="h-2 w-5 rounded" style={{ background: REST_FILL }} />
          {HEAT.map((c) => (
            <span key={c} className="h-2 w-5 rounded" style={{ background: c }} />
          ))}
          <span>More · 7 days</span>
        </div>
        <span className="tnum text-[11px] text-[var(--text-muted)]">
          {picked ? `${LABELS[picked]}: ${usage[picked] ?? 0}×` : `${worked.length} groups`}
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
