// The block grid shared by the athlete's own /app and a professional's drill-in
// (/coach/a/[tenantId]). One REGISTRY + one gating rule, so the two views can't
// drift. Pure renderer: it takes resolved data + tenant and draws the blocks the
// tenant's metrics allow.
import type React from "react";
import { BlockBoundary } from "@/components/BlockBoundary";
import { blockAvailable } from "@/lib/tenant-config";
import { readEquipment } from "@/lib/prescription";
import { BLOCKS, type BlockDef, type BlockId } from "@/lib/blocks";
import type { DashboardData } from "@/lib/types";
import type { Locale } from "@/lib/i18n";
import type { TenantView } from "@/lib/data-product";
import { HeroBlock } from "@/components/blocks/HeroBlock";
import { FitnessBlock } from "@/components/blocks/FitnessBlock";
import { CalendarBlock } from "@/components/blocks/CalendarBlock";
import { AvailabilityBlock } from "@/components/blocks/AvailabilityBlock";
import { SeasonBlock } from "@/components/blocks/SeasonBlock";
import { MenstrualCycleBlock } from "@/components/blocks/MenstrualCycleBlock";
import { ZonesBlock } from "@/components/blocks/ZonesBlock";
import { MealPlanBlock } from "@/components/blocks/MealPlanBlock";
import { BodyBlock } from "@/components/blocks/BodyBlock";
import { StrengthBlock } from "@/components/blocks/StrengthBlock";
import { WatchPointsBlock } from "@/components/blocks/WatchPointsBlock";
import { LifestyleBlock } from "@/components/blocks/LifestyleBlock";
import { VitalsBlock } from "@/components/blocks/VitalsBlock";

type BlockProps = {
  data: DashboardData;
  todayISO: string;
  locale: Locale;
  tenant: TenantView;
  /** The viewer owns this dashboard, so blocks may offer writes (dragging a
   * session to another day). Off by default — the coach drill-in reuses these
   * same blocks and must stay read-only. */
  editable: boolean;
};

const REGISTRY: Record<BlockId, (p: BlockProps) => React.ReactNode> = {
  hero: (p) => (
    <HeroBlock
      data={p.data}
      locale={p.locale}
      target={{
        raceName: p.tenant.raceName ?? p.tenant.cycleName ?? "",
        raceISO: p.tenant.raceName ? p.tenant.raceISO : null,
        cycle: p.tenant.raceName ? null : p.tenant.cycle,
        races: p.tenant.races,
      }}
    />
  ),
  // Read-only by construction: takes no `editable`, offers no writes, so the
  // coach drill-in gets the identical card.
  vitals: (p) => (
    <VitalsBlock data={p.data} metrics={p.tenant.metrics} todayISO={p.todayISO} locale={p.locale} />
  ),
  fitness: (p) => <FitnessBlock data={p.data} locale={p.locale} />,
  calendar: (p) => (
    <CalendarBlock
      data={p.data}
      todayISO={p.todayISO}
      locale={p.locale}
      units={p.tenant.units}
      // Decides whether a block reads "242-258W", "4:25-4:15/km" or "7/10".
      equipment={readEquipment(p.tenant.preferences?.equipment)}
      editable={p.editable}
    />
  ),
  availability: (p) => (
    // Read-only, and ONLY for the coach: on the athlete's own dashboard this
    // moved behind the settings gear, where configuration belongs. For a coach
    // it is not configuration, it is what they need to know before writing a
    // week — so it stays a block on the drill-in.
    <AvailabilityBlock preferences={p.tenant.preferences ?? {}} locale={p.locale} editable={false} />
  ),
  season: (p) => <SeasonBlock data={p.data} todayISO={p.todayISO} locale={p.locale} />,
  menstrual: (p) => <MenstrualCycleBlock data={p.data} todayISO={p.todayISO} locale={p.locale} />,
  zones: (p) => <ZonesBlock data={p.data} locale={p.locale} />,
  mealplan: (p) => <MealPlanBlock data={p.data} locale={p.locale} />,
  body: (p) => <BodyBlock data={p.data} locale={p.locale} units={p.tenant.units} />,
  strength: (p) => <StrengthBlock data={p.data} locale={p.locale} anatomy={p.tenant.anatomy} />,
  watchpoints: (p) => <WatchPointsBlock data={p.data} locale={p.locale} />,
  lifestyle: (p) => <LifestyleBlock data={p.data} locale={p.locale} />,
};

export function DashboardBlocks({
  data,
  tenant,
  locale,
  todayISO,
  editable = false,
}: {
  data: DashboardData;
  tenant: TenantView;
  locale: Locale;
  todayISO: string;
  editable?: boolean;
}) {
  const props: BlockProps = { data, todayISO, locale, tenant, editable };

  // Only blocks this athlete can actually feed (adaptive gating on declared
  // metrics) — minus, on the athlete's OWN dashboard, the one that is settings
  // rather than reading. "My week" is answered about twice a year and was
  // competing every day with the calendar and the fitness chart; it now lives
  // behind the gear in the top bar. The coach's drill-in keeps it, because for
  // them it is not a setting, it is what they need before writing a week.
  const enabled = BLOCKS.filter(
    (b) => b.enabled && blockAvailable(b.requires, tenant.metrics) && !(editable && b.id === "availability"),
  );
  const groups: (BlockDef | BlockDef[])[] = [];
  for (const b of enabled) {
    const last = groups[groups.length - 1];
    if (b.width === "third" && Array.isArray(last)) last.push(b);
    else if (b.width === "third") groups.push([b]);
    else groups.push(b);
  }

  return (
    <div className="flex flex-col gap-[22px]">
      {groups.map((g, i) =>
        Array.isArray(g) ? (
          <div key={i} className="grid grid-cols-1 gap-[22px] md:grid-cols-2 lg:grid-cols-3">
            {g.map((b) => (
              <BlockBoundary key={b.id} id={b.id} locale={locale}>
                {REGISTRY[b.id](props)}
              </BlockBoundary>
            ))}
          </div>
        ) : (
          <BlockBoundary key={g.id} id={g.id} locale={locale}>
            {REGISTRY[g.id](props)}
          </BlockBoundary>
        ),
      )}
    </div>
  );
}
