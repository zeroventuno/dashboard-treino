// Original, minimal line icons for the four modalities (no third-party art).
// Monochrome + stroke-based so they inherit `currentColor`: the card lights the
// trained ones (full colour) and dims the rest. Swap for an open-licensed set
// (Tabler / Lucide, MIT) later if you want more detail.
import type { CSSProperties } from "react";

const base = {
  width: 15,
  height: 15,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const PATHS: Record<string, React.ReactNode> = {
  // swimmer: head + reaching arm over a wave
  swim: (
    <>
      <circle cx="8" cy="7.5" r="1.7" />
      <path d="M9.4 8.7 13.5 6.7 17 8.3" />
      <path d="M2.5 15.5c1.4-1.4 2.8-1.4 4.2 0s2.8 1.4 4.2 0 2.8-1.4 4.2 0 2.8 1.4 4.2 0" />
    </>
  ),
  // bicycle: two wheels + frame + handlebar
  bike: (
    <>
      <circle cx="6" cy="16.5" r="3.4" />
      <circle cx="18" cy="16.5" r="3.4" />
      <path d="M6 16.5 9.5 8.5H14l4 8" />
      <path d="M9.5 8.5H15.5" />
      <path d="M15.5 8.5 17 6h1.5" />
    </>
  ),
  // runner: head + leaning body, arms and legs mid-stride
  run: (
    <>
      <circle cx="15" cy="5.3" r="1.7" />
      <path d="M14 8.4 10.4 11l2.1 2.4-2 5.6" />
      <path d="M10.4 11 6.8 10.6" />
      <path d="M12.5 13.4 16 15" />
    </>
  ),
  // dumbbell: two plates each side + bar
  strength: (
    <>
      <path d="M4 9v6M6.5 7.5v9M17.5 7.5v9M20 9v6" />
      <path d="M6.5 12h11" />
    </>
  ),
};

export function SportIcon({ sport, style }: { sport: string; style?: CSSProperties }) {
  const p = PATHS[sport];
  if (!p) return null;
  return (
    <svg {...base} style={style} aria-hidden>
      {p}
    </svg>
  );
}
