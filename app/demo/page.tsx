// ────────────────────────────────────────────────────────────────────────────
//  /demo — config-driven dashboard prototype.
//
//  Same real blocks as production, but rendered from a TenantConfig: only the
//  blocks whose required metrics the athlete has show up, and the hero adapts
//  to race vs cycle mode. Switch profiles with ?profile=race | ?profile=cycle.
//  Uses mock data (masked per profile) — no backend needed.
// ────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { Fragment } from "react";
import { getMockData } from "@/lib/mock";
import { toISO } from "@/lib/utils";
import { BLOCKS, type BlockDef, type BlockId } from "@/lib/blocks";
import { DEMO_PROFILES, blockAvailable, type TenantConfig } from "@/lib/tenant-config";
import type { DashboardData } from "@/lib/types";
import { DemoHero, cycleToPhases } from "@/components/DemoHero";
import { FitnessBlock } from "@/components/blocks/FitnessBlock";
import { CalendarBlock } from "@/components/blocks/CalendarBlock";
import { SeasonBlock } from "@/components/blocks/SeasonBlock";
import { ZonesBlock } from "@/components/blocks/ZonesBlock";
import { MealPlanBlock } from "@/components/blocks/MealPlanBlock";
import { BodyBlock } from "@/components/blocks/BodyBlock";
import { StrengthBlock } from "@/components/blocks/StrengthBlock";
import { WatchPointsBlock } from "@/components/blocks/WatchPointsBlock";
import { LifestyleBlock } from "@/components/blocks/LifestyleBlock";

// fixed "today" so the demo countdown/cycle math is stable
const DEMO_TODAY = "2026-07-11";

type BlockProps = { config: TenantConfig; data: DashboardData; todayISO: string };

const REGISTRY: Record<BlockId, (p: BlockProps) => React.ReactNode> = {
  hero: (p) => <DemoHero config={p.config} data={p.data} todayISO={p.todayISO} />,
  fitness: (p) => <FitnessBlock data={p.data} />,
  calendar: (p) => <CalendarBlock data={p.data} todayISO={p.todayISO} />,
  season: (p) => <SeasonBlock data={p.data} todayISO={p.todayISO} />,
  zones: (p) => <ZonesBlock data={p.data} />,
  mealplan: (p) => <MealPlanBlock data={p.data} />,
  body: (p) => <BodyBlock data={p.data} />,
  strength: (p) => <StrengthBlock data={p.data} />,
  watchpoints: (p) => <WatchPointsBlock data={p.data} />,
  lifestyle: (p) => <LifestyleBlock data={p.data} />,
};

/** Mock data masked to the athlete's available metrics (so even blocks that
 * render adapt: no protein ring without a protein metric, cycle phases for a
 * no-race athlete, etc.). */
function demoData(config: TenantConfig): DashboardData {
  const base = getMockData();

  const checkins = base.checkins.map((c) => ({
    ...c,
    hrv: config.metrics.includes("hrv") ? c.hrv : null,
    body_battery: config.metrics.includes("body_battery") ? c.body_battery : null,
    hydration_liters: config.metrics.includes("hydration") ? c.hydration_liters : null,
    whey_shakes: config.metrics.includes("protein") ? c.whey_shakes : null,
    protein_grams_estimate: config.metrics.includes("protein") ? c.protein_grams_estimate : null,
  }));

  if (config.mode === "cycle") {
    return {
      ...base,
      checkins,
      phases: cycleToPhases(config),
      milestones: [],
      bodyComposition: config.metrics.includes("bioimpedance") ? base.bodyComposition : [],
      mealPlan: config.metrics.includes("nutrition") ? base.mealPlan : [],
      nutritionRules: config.metrics.includes("nutrition") ? base.nutritionRules : [],
      strength: config.metrics.includes("strength") ? base.strength : [],
    };
  }
  return { ...base, checkins };
}

const METRIC_LABEL: Record<string, string> = {
  hrv: "HRV", body_battery: "Body Battery", sleep: "Sono", readiness: "Prontidão",
  power: "Potência", zones: "Zonas", bioimpedance: "Bioimpedância",
  nutrition: "Nutrição", strength: "Força", hydration: "Hidratação", protein: "Proteína",
};

export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string }>;
}) {
  const { profile } = await searchParams;
  const key = profile && DEMO_PROFILES[profile] ? profile : "race";
  const config = DEMO_PROFILES[key];
  const data = demoData(config);
  const props: BlockProps = { config, data, todayISO: DEMO_TODAY };

  const visible = BLOCKS.filter((b) => b.enabled && blockAvailable(b.requires, config.metrics));
  const hiddenIds = BLOCKS.filter((b) => b.enabled && !blockAvailable(b.requires, config.metrics)).map((b) => b.id);

  // group consecutive "third" blocks into a responsive row (same as production)
  const groups: (BlockDef | BlockDef[])[] = [];
  for (const b of visible) {
    const last = groups[groups.length - 1];
    if (b.width === "third" && Array.isArray(last)) last.push(b);
    else if (b.width === "third") groups.push([b]);
    else groups.push(b);
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      {/* demo control bar */}
      <div className="sticky top-0 z-40 -mx-4 mb-5 border-b border-[var(--border-soft)] bg-[rgba(38,43,52,0.9)] px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-[var(--lime)] px-2 py-[3px] text-[10px] font-extrabold uppercase tracking-wide text-[#0a0b0d]">Demo</span>
            <span className="text-[12.5px] text-[var(--text-muted)]">Dashboard adaptativo por perfil</span>
          </div>
          <div className="flex gap-1.5">
            {Object.entries(DEMO_PROFILES).map(([k, c]) => {
              const on = k === key;
              return (
                <Link
                  key={k}
                  href={`/demo?profile=${k}`}
                  className="rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition-colors"
                  style={{
                    borderColor: on ? "var(--lime)" : "var(--border)",
                    background: on ? "var(--lime)" : "transparent",
                    color: on ? "#0a0b0d" : "var(--text-muted)",
                  }}
                >
                  {c.mode === "race" ? "🎯 Com provas" : "🔄 Ciclo (sem prova)"}
                </Link>
              );
            })}
          </div>
        </div>

        {/* what this profile has / hides */}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
          <span className="text-[var(--text-faint)]">
            Métricas disponíveis:{" "}
            {config.metrics.map((m) => METRIC_LABEL[m] ?? m).join(" · ")}
          </span>
          {hiddenIds.length > 0 && (
            <span className="text-[var(--text-faint)]">
              · Blocos ocultos por falta de dado:{" "}
              <span className="text-[var(--warn)]">{hiddenIds.join(", ")}</span>
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-[22px]">
        {groups.map((g, i) =>
          Array.isArray(g) ? (
            <div key={i} className="grid grid-cols-1 gap-[22px] md:grid-cols-2 lg:grid-cols-3">
              {g.map((b) => <Fragment key={b.id}>{REGISTRY[b.id](props)}</Fragment>)}
            </div>
          ) : (
            <Fragment key={g.id}>{REGISTRY[g.id](props)}</Fragment>
          ),
        )}
      </div>

      <p className="mt-8 text-center text-[11px] text-[var(--text-faint)]">
        Protótipo · os dados são fictícios. No produto real, o coach-chat grava a config e os dados de cada atleta.
      </p>
    </div>
  );
}
