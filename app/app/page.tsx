// ────────────────────────────────────────────────────────────────────────────
//  /app — the multi-tenant PRODUCT dashboard (reads the NEW project per tenant).
//
//  Additive and isolated from the live personal dashboard at `/` (which still
//  reads the old project via lib/data.ts). Auth is per-tenant: the account key
//  lives in an httpOnly cookie (see /api/app-login) — not the shared dashboard
//  password, and not the URL. A ?key= link still works as a magic link: it logs
//  you in and bounces to a clean /app.
// ────────────────────────────────────────────────────────────────────────────

import { Fragment } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getProductDashboardData, resolveTenantId } from "@/lib/data-product";
import { hasProductDb } from "@/lib/product-db";
import { APP_COOKIE } from "@/app/api/app-login/route";
import { toISO } from "@/lib/utils";
import { BLOCKS, type BlockDef, type BlockId } from "@/lib/blocks";
import type { DashboardData } from "@/lib/types";
import { translator, type Locale, type TKey } from "@/lib/i18n";
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

type BlockProps = { data: DashboardData; todayISO: string; locale: Locale };

const REGISTRY: Record<BlockId, (p: BlockProps) => React.ReactNode> = {
  hero: (p) => <HeroBlock data={p.data} locale={p.locale} />,
  fitness: (p) => <FitnessBlock data={p.data} locale={p.locale} />,
  calendar: (p) => <CalendarBlock data={p.data} todayISO={p.todayISO} locale={p.locale} />,
  season: (p) => <SeasonBlock data={p.data} todayISO={p.todayISO} locale={p.locale} />,
  zones: (p) => <ZonesBlock data={p.data} locale={p.locale} />,
  mealplan: (p) => <MealPlanBlock data={p.data} locale={p.locale} />,
  body: (p) => <BodyBlock data={p.data} locale={p.locale} />,
  strength: (p) => <StrengthBlock data={p.data} locale={p.locale} />,
  watchpoints: (p) => <WatchPointsBlock data={p.data} locale={p.locale} />,
  lifestyle: (p) => <LifestyleBlock data={p.data} locale={p.locale} />,
};

export default async function ProductDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const { key } = await searchParams;

  // Magic link from the onboarding message: log in, then land on a clean /app
  // so the key never sticks around in the address bar or browser history.
  if (key) redirect(`/api/app-login?key=${encodeURIComponent(key)}`);

  const dbConfigured = hasProductDb();
  const cookieKey = (await cookies()).get(APP_COOKIE)?.value ?? null;

  // No session → the athlete's own login (not the shared dashboard password).
  if (!cookieKey) redirect("/app/login");

  const tenantId = await resolveTenantId(cookieKey);

  // Stale/revoked key: send them back to log in rather than showing sample data.
  if (dbConfigured && !tenantId) redirect("/app/login?erro=1");

  const { data, live, locale } = await getProductDashboardData(tenantId ?? "");

  const tr = translator(locale);

  // Say exactly WHY we fell back to mock — silent sample data is impossible to debug.
  const reason: TKey | null = live
    ? null
    : !dbConfigured
      ? "app.reason.noDb"
      : "app.reason.empty";
  const props: BlockProps = { data, todayISO: toISO(new Date()), locale };

  const readiness = data.checkins.at(-1)?.recommendation ?? undefined;

  const enabled = BLOCKS.filter((b) => b.enabled);
  const groups: (BlockDef | BlockDef[])[] = [];
  for (const b of enabled) {
    const last = groups[groups.length - 1];
    if (b.width === "third" && Array.isArray(last)) last.push(b);
    else if (b.width === "third") groups.push([b]);
    else groups.push(b);
  }

  return (
    <div data-readiness={readiness} className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <nav className="sticky top-0 z-40 -mx-4 mb-4 flex items-center justify-between gap-3 border-b border-[var(--border-soft)] bg-[rgba(38,43,52,0.82)] px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-trak.png" alt="TRAK" className="h-[26px] w-auto" />
        <span className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-[5px] text-[11.5px] font-medium text-[var(--text-muted)]">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: live ? "var(--good)" : "var(--warn)" }} />
          {live ? tr("common.live") : tenantId ? tr("app.noData") : tr("common.sampleData")}
        </span>
      </nav>

      {!live && reason && (
        <div className="mb-4 rounded-[14px] border border-[var(--warn)]/40 bg-[var(--surface-2)] px-4 py-3 text-[12.5px] text-[var(--text-muted)]">
          <span className="font-semibold text-[var(--warn)]">{tr("app.sampleBanner")} · </span>
          {tr(reason)}
        </div>
      )}

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
    </div>
  );
}
