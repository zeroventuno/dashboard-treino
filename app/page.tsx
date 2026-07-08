import { Fragment } from "react";
import { getDashboardData } from "@/lib/data";
import { toISO } from "@/lib/utils";
import { DaysPill } from "@/components/Countdown";
import { BLOCKS, type BlockDef, type BlockId } from "@/lib/blocks";
import type { DashboardData } from "@/lib/types";
import { HeroBlock } from "@/components/blocks/HeroBlock";
import { FitnessBlock } from "@/components/blocks/FitnessBlock";
import { CalendarBlock } from "@/components/blocks/CalendarBlock";
import { SeasonBlock } from "@/components/blocks/SeasonBlock";
import { ZonesBlock } from "@/components/blocks/ZonesBlock";
import { MealPlanBlock } from "@/components/blocks/MealPlanBlock";
import { BodyBlock } from "@/components/blocks/BodyBlock";
import { StrengthBlock } from "@/components/blocks/StrengthBlock";
import { WatchPointsBlock } from "@/components/blocks/WatchPointsBlock";
import { LifestyleBlock } from "@/components/blocks/LifestyleBlock";

export const revalidate = 60;

type BlockProps = { data: DashboardData; todayISO: string };

// id → renderer. Adding/removing a block here + in lib/blocks.ts is all it takes.
const REGISTRY: Record<BlockId, (p: BlockProps) => React.ReactNode> = {
  hero: (p) => <HeroBlock data={p.data} />,
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

export default async function DashboardPage() {
  const { data, live } = await getDashboardData();
  const props: BlockProps = { data, todayISO: toISO(new Date()) };

  // Group consecutive "third" blocks into a single responsive row.
  const enabled = BLOCKS.filter((b) => b.enabled);
  const groups: (BlockDef | BlockDef[])[] = [];
  for (const b of enabled) {
    const last = groups[groups.length - 1];
    if (b.width === "third" && Array.isArray(last)) last.push(b);
    else if (b.width === "third") groups.push([b]);
    else groups.push(b);
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      {/* sticky top bar */}
      <nav className="sticky top-0 z-40 -mx-4 mb-4 flex items-center justify-between gap-3 border-b border-[var(--border-soft)] bg-[rgba(38,43,52,0.82)] px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-trak.png" alt="TRAK" className="h-[26px] w-auto" />
        <div className="flex items-center gap-2">
          <span className="hidden rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-[5px] text-[11.5px] font-semibold text-[var(--text-muted)] sm:inline">
            IRONMAN 70.3 Costa Navarino
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-[5px] text-[11.5px] font-medium text-[var(--text-muted)]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: live ? "var(--good)" : "var(--warn)" }} />
            {live ? "Live" : "Sample data"}
          </span>
          <DaysPill />
        </div>
      </nav>

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

      <footer className="mt-9 text-center">
        <p className="dsp text-[15px] font-extrabold uppercase tracking-[0.3em] text-[var(--text-muted)]">
          Train. Track. <span className="text-[var(--lime)]">Evolve.</span>
        </p>
        <p className="mt-1.5 text-[11px] text-[var(--text-faint)]">Synced automatically via daily check-ins · TRAK personal training dashboard</p>
      </footer>
    </div>
  );
}
