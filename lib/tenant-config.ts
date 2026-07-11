// ────────────────────────────────────────────────────────────────────────────
//  TENANT CONFIG — the per-user profile that drives an adaptive dashboard.
//
//  In the productized (multi-tenant) TRAK, the coach chat records this once
//  (a discovery step: "list every device and what it measures") and keeps it
//  updated. The dashboard is a pure renderer of this config + the tenant's
//  data — it shows only the blocks whose required metrics the athlete has,
//  and switches the hero between race-countdown and training-cycle modes.
//
//  This file also ships two example profiles used by the /demo route so the
//  adaptivity can be seen without a backend.
// ────────────────────────────────────────────────────────────────────────────

import type { BlockId } from "./blocks";

/** Capability flags — what data/devices the athlete actually has available. */
export type Metric =
  | "hrv"
  | "body_battery"
  | "sleep"
  | "readiness"
  | "power"          // cycling power meter
  | "zones"          // has defined performance zones (HR / pace / power)
  | "bioimpedance"   // smart scale
  | "nutrition"      // meal plan / fueling guidance
  | "strength"       // logs strength sessions
  | "hydration"
  | "protein";

export interface RaceTarget {
  name: string;
  date: string; // YYYY-MM-DD
  priority: "A" | "B" | "C";
}

export interface TrainingCycle {
  name: string;      // e.g. "Ciclo de base — 16 semanas"
  startDate: string; // YYYY-MM-DD
  weeks: number;
  phases: { name: string; weeks: number; focus: string }[];
}

export interface TenantConfig {
  athlete: string;
  device: string; // human label, e.g. "Garmin Fēnix 7 + Stryd"
  mode: "race" | "cycle";
  metrics: Metric[];
  races?: RaceTarget[]; // when mode === "race"
  cycle?: TrainingCycle; // when mode === "cycle"
  locale?: "pt" | "en" | "es" | "it";
  units?: "metric" | "imperial";
}

/** A block renders only if the athlete has every metric it requires. */
export function blockAvailable(requires: Metric[] | undefined, have: Metric[]): boolean {
  if (!requires || requires.length === 0) return true;
  return requires.every((m) => have.includes(m));
}

/** Two contrasting example athletes for the /demo route. */
export const DEMO_PROFILES: Record<string, TenantConfig> = {
  // Full kit, multi-race triathlete (≈ the current live dashboard).
  race: {
    athlete: "Rafael — triatleta",
    device: "Garmin Fēnix 7 · Stryd · balança de bioimpedância",
    mode: "race",
    metrics: [
      "hrv", "body_battery", "sleep", "readiness", "power", "zones",
      "bioimpedance", "nutrition", "strength", "hydration", "protein",
    ],
    races: [
      { name: "IRONMAN 70.3 Costa Navarino", date: "2026-10-25", priority: "A" },
      { name: "Meia maratona (rehearsal)", date: "2026-10-04", priority: "B" },
      { name: "Triatlo olímpico (prep)", date: "2026-08-16", priority: "C" },
    ],
    locale: "pt",
    units: "metric",
  },

  // Minimal kit runner, no race — just training toward a goal on a cycle.
  cycle: {
    athlete: "Marina — corredora",
    device: "Amazfit GTR (FC + sono, sem potência/bioimpedância)",
    mode: "cycle",
    // No HRV, no power, no bioimpedance, no nutrition/strength tracking.
    metrics: ["sleep", "readiness", "zones", "hydration"],
    cycle: {
      name: "Ciclo de base — 16 semanas",
      startDate: "2026-05-25",
      weeks: 16,
      phases: [
        { name: "Base", weeks: 8, focus: "Volume aeróbio e consistência" },
        { name: "Build", weeks: 5, focus: "Limiar e ritmo" },
        { name: "Peak", weeks: 3, focus: "Afiamento e ritmo-alvo" },
      ],
    },
    locale: "pt",
    units: "metric",
  },
};

/** Which blocks each profile would show — handy for captions/tests. */
export type { BlockId };
