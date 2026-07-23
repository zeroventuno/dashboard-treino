// ────────────────────────────────────────────────────────────────────────────
//  /app — the multi-tenant PRODUCT dashboard (reads the NEW project per tenant).
//
//  Additive and isolated from the live personal dashboard at `/` (which still
//  reads the old project via lib/data.ts). Auth is per-tenant: the account key
//  lives in an httpOnly cookie (see /api/app-login) — not the shared dashboard
//  password, and not the URL. A ?key= link still works as a magic link: it logs
//  you in and bounces to a clean /app.
// ────────────────────────────────────────────────────────────────────────────

import { cookies, headers } from "next/headers";
import { BlockBoundary } from "@/components/BlockBoundary";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  getDashboardSubject,
  getProductDashboardData,
  isUnconfigured,
  resolveTenantId,
  type TenantView,
} from "@/lib/data-product";
import { blockAvailable } from "@/lib/tenant-config";
import { Onboarding } from "@/components/Onboarding";
import { hasProductDb } from "@/lib/product-db";
import { APP_COOKIE } from "@/app/api/app-login/route";
import { toISO } from "@/lib/utils";
import { Tagline } from "@/components/Tagline";
import { BLOCKS, type BlockDef, type BlockId } from "@/lib/blocks";
import type { DashboardData } from "@/lib/types";
import { pickLocale, translator, type Locale, type TKey } from "@/lib/i18n";
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

/** Tab title names what the athlete is training for — with several TRAK tabs
 * open, "TRAK" alone tells you nothing about which one you're looking at. */
export async function generateMetadata(): Promise<Metadata> {
  const cookieKey = (await cookies()).get(APP_COOKIE)?.value ?? null;
  if (!cookieKey) return { title: "TRAK" };

  const tenantId = await resolveTenantId(cookieKey);
  const subject = tenantId ? await getDashboardSubject(tenantId) : null;
  return { title: subject ? `TRAK · ${subject}` : "TRAK" };
}

type BlockProps = { data: DashboardData; todayISO: string; locale: Locale; tenant: TenantView };

const REGISTRY: Record<BlockId, (p: BlockProps) => React.ReactNode> = {
  hero: (p) => (
    <HeroBlock
      data={p.data}
      locale={p.locale}
      target={{
        // Race, else the cycle's name, else nothing scheduled — never the repo
        // owner's race, which is what this used to fall back to.
        raceName: p.tenant.raceName ?? p.tenant.cycleName ?? "",
        raceISO: p.tenant.raceName ? p.tenant.raceISO : null,
        cycle: p.tenant.raceName ? null : p.tenant.cycle,
        races: p.tenant.races,
      }}
    />
  ),
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

  const { data, live, locale, tenant } = await getProductDashboardData(tenantId ?? "");

  const tr = translator(locale);

  // Nothing configured and nothing logged: show what to do, not eight empty
  // blocks. Vanishes on its own the moment the coach writes anything.
  if (live && isUnconfigured(tenant, data)) {
    // profiles.locale is still the 'pt' default here — the coach hasn't run
    // set_profile yet, so it isn't a real choice. This is the first screen a
    // brand-new athlete sees, and an Italian friend would read a Portuguese
    // welcome and paste a Portuguese briefing. Fall back to the browser
    // language, exactly like /app/login does before it knows who you are.
    const onboardingLocale = pickLocale((await headers()).get("accept-language"));
    return (
      <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
        <nav className="mb-4 flex items-center justify-between gap-3 border-b border-[var(--border-soft)] px-1 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-trakr.svg" alt="MY TRAKR" className="h-[26px] w-auto" />
        </nav>
        <Onboarding
          locale={onboardingLocale}
          athlete={tenant.athlete}
          connectorUrl={process.env.MCP_CONNECTOR_URL ?? "https://dashboard-treino-zeroventunos-projects.vercel.app/api/mcp?key=SUA_CHAVE"}
        />
      </div>
    );
  }

  // Say exactly WHY we fell back to mock — silent sample data is impossible to debug.
  const reason: TKey | null = live
    ? null
    : !dbConfigured
      ? "app.reason.noDb"
      : "app.reason.empty";
  const props: BlockProps = { data, todayISO: toISO(new Date()), locale, tenant };

  const readiness = data.checkins.at(-1)?.recommendation ?? undefined;

  // Only blocks this athlete can actually feed. The product used to render
  // every block to everyone -- so an athlete with no scale still got an empty
  // body-composition panel. /demo has always gated on this; /app never did.
  const enabled = BLOCKS.filter((b) => b.enabled && blockAvailable(b.requires, tenant.metrics));
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
        <img src="/logo-trakr.svg" alt="MY TRAKR" className="h-[26px] w-auto" />
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
              {g.map((b) => (
                <BlockBoundary key={b.id} id={b.id} locale={props.locale}>
                  {REGISTRY[b.id](props)}
                </BlockBoundary>
              ))}
            </div>
          ) : (
            <BlockBoundary key={g.id} id={g.id} locale={props.locale}>
              {REGISTRY[g.id](props)}
            </BlockBoundary>
          ),
        )}
      </div>

      <footer className="mt-9 text-center">
        <Tagline />
        <p className="mt-1.5 text-[11px] text-[var(--text-faint)]">{tr("app.footer")}</p>
      </footer>
    </div>
  );
}
