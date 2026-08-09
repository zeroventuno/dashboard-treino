// The page's atmosphere.
//
// The design's own background is a fixed hairline grid over near-black. Kept,
// and given depth it was missing: a slow lime/teal bloom behind the fold, and
// film grain — which is what stops a large dark gradient from banding into
// visible steps on a cheap panel.
//
// Four layers, all CSS and one inline SVG. No image request, nothing for the
// first paint to wait on.

/** feTurbulence, rendered once by the browser and tiled. 160×160 keeps the
 * repeat invisible while the data URI stays under a kilobyte. */
const GRAIN =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160">
      <filter id="n">
        <feTurbulence type="fractalNoise" baseFrequency="0.82" numOctaves="4" stitchTiles="stitch"/>
        <feColorMatrix type="saturate" values="0"/>
      </filter>
      <rect width="160" height="160" filter="url(#n)" opacity="0.55"/>
    </svg>`.replace(/\s+/g, " "),
  );

export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[1] overflow-hidden">
      {/* Blooms, behind the grid so the lines read as drawn ON the light. */}
      <div
        className="ld-drift absolute -left-[10%] -top-[18%] h-[85vh] w-[80vw]"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(166,229,26,.13), rgba(8,9,10,0) 62%)",
        }}
      />
      <div
        className="ld-drift-slow absolute -right-[14%] top-[46%] h-[70vh] w-[70vw]"
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(46,211,183,.09), rgba(8,9,10,0) 60%)",
        }}
      />

      {/* The grid: rows every 140px, columns every eighth of the viewport, so
          the vertical rhythm follows the screen rather than a fixed pixel size
          that would crowd a phone and stretch thin on a wide monitor. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.028) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(255,255,255,.028) 1px, transparent 1px)",
          backgroundSize: "100% 140px, 12.5vw 100%",
        }}
      />

      {/* Grain, on overlay so it stays out of the deepest blacks — visible noise
          in the shadows reads as compression, not texture. */}
      <div
        className="absolute inset-0 opacity-[0.045] mix-blend-overlay"
        style={{ backgroundImage: `url("${GRAIN}")`, backgroundRepeat: "repeat" }}
      />

      {/* Vignette, so the fixed nav and the rail always have something to sit
          against no matter which section is behind them. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(130% 95% at 50% 40%, transparent 48%, rgba(0,0,0,.45) 100%)",
        }}
      />
    </div>
  );
}
