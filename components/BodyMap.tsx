"use client";

import { useState } from "react";
import type { MuscleGroup, StrengthSession } from "@/lib/types";
import { muscleUsage } from "@/lib/utils";

// ────────────────────────────────────────────────────────────────────────────
//  Anatomy comes from public/musculos_interativos.svg — the path data is
//  artwork and is kept verbatim. Earlier versions of this component drew
//  muscles as ellipses and rounded rects, because hand-authoring anatomical
//  curves by typing coordinates does not work.
//
//  That file holds both figures side by side in one 1000×800 canvas. Rather
//  than split it into two files, each panel renders the same paths through a
//  different viewBox — one source of truth for the drawing.
// ────────────────────────────────────────────────────────────────────────────

type View = "front" | "back";

const OUTLINE: Record<View, { head: [number, number]; path: string }> = {
  front: {
    head: [280, 90],
    path: "M245 145 Q210 160 185 205 L155 350 Q145 420 175 500 L205 455 215 290 230 255 220 510 235 710 270 710 280 505 290 710 325 710 340 510 330 255 345 290 355 455 385 500 Q415 420 405 350 L375 205 Q350 160 315 145Z",
  },
  back: {
    head: [720, 90],
    path: "M685 145 Q650 160 625 205 L595 350 Q585 420 615 500 L645 455 655 290 670 255 660 510 675 710 710 710 720 505 730 710 765 710 780 510 770 255 785 290 795 455 825 500 Q855 420 845 350 L815 205 Q790 160 755 145Z",
  },
};

/** Each figure sits in its own half of the shared canvas. */
const VIEWBOX: Record<View, string> = {
  front: "140 25 280 700",
  back: "580 25 280 700",
};

const MUSCLES: Record<View, { group: MuscleGroup; paths: string[] }[]> = {
  front: [
    { group: "chest", paths: [
      "M230 185 Q250 165 277 180 L277 245 Q240 260 220 225Z",
      "M283 180 Q310 165 330 185 L340 225 Q320 260 283 245Z",
    ] },
    { group: "shoulders", paths: [
      "M220 178 Q190 185 185 225 Q205 215 225 195Z",
      "M340 178 Q370 185 375 225 Q355 215 335 195Z",
    ] },
    { group: "biceps", paths: [
      "M190 235 Q215 230 215 300 Q205 335 185 315Z",
      "M370 235 Q345 230 345 300 Q355 335 375 315Z",
    ] },
    { group: "core", paths: [
      "M250 260 H275 V300 H250Z",
      "M285 260 H310 V300 H285Z",
      "M250 310 H275 V350 H250Z",
      "M285 310 H310 V350 H285Z",
      "M255 360 Q280 350 305 360 L295 440 H265Z",
    ] },
    { group: "quadriceps", paths: [
      "M235 450 Q270 420 272 500 L260 610 Q225 570 230 500Z",
      "M325 450 Q290 420 288 500 L300 610 Q335 570 330 500Z",
    ] },
    { group: "calves", paths: [
      "M238 615 Q260 600 265 650 L250 700Z",
      "M322 615 Q300 600 295 650 L310 700Z",
    ] },
  ],
  back: [
    { group: "shoulders", paths: [
      "M660 178 Q630 185 625 225 Q645 215 665 195Z",
      "M780 178 Q810 185 815 225 Q795 215 775 195Z",
    ] },
    { group: "triceps", paths: [
      "M630 235 Q655 230 655 300 Q645 335 625 315Z",
      "M810 235 Q785 230 785 300 Q795 335 815 315Z",
    ] },
    { group: "back", paths: [
      "M675 200 Q700 210 712 245 L700 380 Q660 340 660 255Z",
      "M765 200 Q740 210 728 245 L740 380 Q780 340 780 255Z",
    ] },
    { group: "glutes", paths: [
      "M665 390 Q715 370 715 440 Q690 470 660 445Z",
      "M775 390 Q725 370 725 440 Q750 470 780 445Z",
    ] },
    { group: "hamstrings", paths: [
      "M665 455 Q710 450 710 510 L690 610 Q660 570 660 500Z",
      "M775 455 Q730 450 730 510 L750 610 Q780 570 780 500Z",
    ] },
    { group: "calves", paths: [
      "M675 615 Q710 600 710 650 L690 700 Q665 665 670 630Z",
      "M765 615 Q730 600 730 650 L750 700 Q775 665 770 630Z",
    ] },
  ],
};

const LABELS: Record<MuscleGroup, string> = {
  quadriceps: "Quads", glutes: "Glutes", hamstrings: "Hamstrings",
  core: "Core", shoulders: "Shoulders", back: "Back", calves: "Calves",
  chest: "Chest", biceps: "Biceps", triceps: "Triceps",
};

// Heat is its own scale, deliberately NOT var(--surge): that variable turns
// orange on a yellow-readiness day, which would repaint the muscle map for a
// reason that has nothing to do with muscles. A heatmap should mean one thing.
const REST_FILL = "#252b33";
const REST_STROKE = "#69717b";
const HEAT = "255, 159, 50";
const HEAT_EDGE = "255, 176, 77";

function heat(count: number, max: number) {
  if (count <= 0) return { fill: REST_FILL, stroke: REST_STROKE, filter: undefined };
  const t = max > 0 ? Math.min(1, count / max) : 1;
  const a = 0.55 + t * 0.45;
  return {
    fill: `rgba(${HEAT}, ${a.toFixed(2)})`,
    stroke: `rgba(${HEAT_EDGE}, ${Math.min(1, a + 0.15).toFixed(2)})`,
    filter: `drop-shadow(0 0 ${(5 + t * 5).toFixed(0)}px rgba(${HEAT}, ${(0.35 + t * 0.35).toFixed(2)}))`,
  };
}

function Figure({
  view,
  usage,
  max,
  hover,
  setHover,
}: {
  view: View;
  usage: Partial<Record<MuscleGroup, number>>;
  max: number;
  hover: MuscleGroup | null;
  setHover: (g: MuscleGroup | null) => void;
}) {
  const { head, path } = OUTLINE[view];

  return (
    <svg viewBox={VIEWBOX[view]} className="mx-auto h-64 w-auto sm:h-72">
      <ellipse cx={head[0]} cy={head[1]} rx={42} ry={58} fill="#151a20" stroke="#747b84" strokeWidth={3} />
      <path d={path} fill="#151a20" stroke="#747b84" strokeWidth={3} />

      {MUSCLES[view].map(({ group, paths }) => {
        const s = heat(usage[group] ?? 0, max);
        const on = hover === group;
        return (
          <g
            key={group}
            onMouseEnter={() => setHover(group)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: "pointer", transition: "opacity .2s", opacity: hover && !on ? 0.55 : 1 }}
          >
            {paths.map((d) => (
              <path
                key={d}
                d={d}
                fill={s.fill}
                stroke={on ? `rgba(${HEAT_EDGE}, 1)` : s.stroke}
                strokeWidth={2}
                style={{ filter: s.filter, transition: "fill .2s, stroke .2s" }}
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export function BodyMap({ sessions }: { sessions: StrengthSession[] }) {
  const usage = muscleUsage(sessions, 7);
  const max = Math.max(1, ...Object.values(usage));
  const [hover, setHover] = useState<MuscleGroup | null>(null);
  const worked = (Object.keys(usage) as MuscleGroup[]).sort((a, b) => (usage[b] ?? 0) - (usage[a] ?? 0));

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {(["front", "back"] as const).map((view) => (
          <figure key={view} className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-soft)] p-2">
            <Figure view={view} usage={usage} max={max} hover={hover} setHover={setHover} />
            <figcaption className="mt-1 text-center text-[10px] uppercase tracking-wide text-[var(--text-faint)]">
              {view === "front" ? "Front" : "Back"}
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-faint)]">
          <span>Less</span>
          <span className="h-2 w-5 rounded" style={{ background: heat(0, max).fill }} />
          <span className="h-2 w-5 rounded" style={{ background: heat(1, 2).fill }} />
          <span className="h-2 w-5 rounded" style={{ background: heat(2, 2).fill }} />
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
