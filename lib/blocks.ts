// ────────────────────────────────────────────────────────────────────────────
//  BLOCK REGISTRY — turn dashboard blocks on/off here.
//
//  To hide a block from the site: set its `enabled` to false (or delete the line).
//  The array order is the render order. `width: "third"` blocks that sit next to
//  each other are grouped into a responsive 3-column row automatically.
// ────────────────────────────────────────────────────────────────────────────

export type BlockId =
  | "hero"        // countdown + readiness banner
  | "fitness"     // PMC chart (CTL/ATL/TSB)
  | "calendar"    // monthly training calendar
  | "season"      // season phases + milestones timeline
  | "zones"       // performance zones (bike/run/swim)
  | "body"        // body composition (bioimpedance) trends
  | "strength"    // body map / muscle use
  | "watchpoints" // injury log
  | "lifestyle";  // sleep / hydration / protein rings

export interface BlockDef {
  id: BlockId;
  enabled: boolean;
  width: "full" | "third";
}

export const BLOCKS: BlockDef[] = [
  { id: "hero",        enabled: true, width: "full" },
  { id: "fitness",     enabled: true, width: "full" },
  { id: "calendar",    enabled: true, width: "full" },
  { id: "season",      enabled: true, width: "full" },
  { id: "zones",       enabled: true, width: "full" },
  { id: "body",        enabled: true, width: "full" },
  { id: "strength",    enabled: true, width: "third" },
  { id: "watchpoints", enabled: true, width: "third" },
  { id: "lifestyle",   enabled: true, width: "third" },
];
