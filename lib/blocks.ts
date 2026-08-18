// ────────────────────────────────────────────────────────────────────────────
//  BLOCK REGISTRY — turn dashboard blocks on/off here.
//
//  To hide a block from the site: set its `enabled` to false (or delete the line).
//  The array order is the render order. `width: "third"` blocks that sit next to
//  each other are grouped into a responsive 3-column row automatically.
// ────────────────────────────────────────────────────────────────────────────

export type BlockId =
  | "hero"        // countdown + readiness banner
  | "vitals"      // HRV / sleep / readiness / body battery / resting HR history
  | "fitness"     // PMC chart (CTL/ATL/TSB)
  | "calendar"    // monthly training calendar
  | "season"      // season phases + milestones timeline
  | "menstrual"   // menstrual-cycle phases + prediction (opt-in, female)
  | "zones"       // performance zones (bike/run/swim)
  | "mealplan"    // daily meal plan + nutrition rules by training duration
  | "body"        // body composition (bioimpedance) trends
  | "strength"    // body map / muscle use
  | "watchpoints" // injury log
  | "lifestyle"   // sleep / hydration / protein rings
  | "availability"; // the athlete's own weekly time budget

import type { Metric } from "./tenant-config";

export interface BlockDef {
  id: BlockId;
  enabled: boolean;
  width: "full" | "third";
  /** Metrics the athlete must have for this block to render (adaptive mode).
   * Empty/undefined = always shown. Used by the config-driven /demo route;
   * the production dashboard ignores it and shows everything. */
  requires?: Metric[];
}

export const BLOCKS: BlockDef[] = [
  { id: "hero",        enabled: true, width: "full" },
  // Directly under the hero, which shows today's readiness — this is the same
  // check-in read as a trend. No `requires`: the gate is an AND and this card
  // is a union of five series that are each gated on their own metric INSIDE
  // the block (lib/vitals VITAL_SERIES, via the same `blockAvailable`), so an
  // AND here would hide four working charts from an athlete missing one strap.
  // VitalsBlock renders null when none of them survive.
  { id: "vitals",      enabled: true, width: "full" },
  { id: "fitness",     enabled: true, width: "full" },
  { id: "calendar",    enabled: true, width: "full" },
  { id: "availability",enabled: true, width: "full" },
  { id: "season",      enabled: true, width: "full" },
  { id: "menstrual",   enabled: true, width: "full",  requires: ["menstrual"] },
  { id: "zones",       enabled: true, width: "full",  requires: ["zones"] },
  { id: "mealplan",    enabled: true, width: "full",  requires: ["nutrition"] },
  { id: "body",        enabled: true, width: "full",  requires: ["bioimpedance"] },
  { id: "strength",    enabled: true, width: "third", requires: ["strength"] },
  { id: "watchpoints", enabled: true, width: "third" },
  { id: "lifestyle",   enabled: true, width: "third", requires: ["sleep"] },
];
