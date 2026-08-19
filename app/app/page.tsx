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
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  getDashboardSubject,
  getProductDashboardData,
  isUnconfigured,
  resolveTenantId,
} from "@/lib/data-product";
import { Onboarding } from "@/components/Onboarding";
import { LogoutButton } from "@/components/LogoutButton";
import { AppNotifications } from "@/components/AppNotifications";
import { AthleteSettings } from "@/components/AthleteSettings";
import { InstallPrompt } from "@/components/InstallPrompt";
import { coachBriefing, BRIEFING_VERSION } from "@/lib/coach-briefing";
import { CONNECTOR_VERSION } from "@/lib/connector";
import { DashboardBlocks } from "@/components/DashboardBlocks";
import { DeviceConnect } from "@/components/DeviceConnect";
import { hasProductDb, getDeviceLink } from "@/lib/product-db";
import { hasStrava, NEW_CONNECTIONS_PAUSED } from "@/lib/strava";
import { APP_COOKIE } from "@/app/api/app-login/route";
import { toISO } from "@/lib/utils";
import { Tagline } from "@/components/Tagline";
import { pickLocale, translator, type TKey } from "@/lib/i18n";

export const revalidate = 60;

/** Tab title names what the athlete is training for — with several MY TRAKR tabs
 * open, "MY TRAKR" alone tells you nothing about which one you're looking at. */
export async function generateMetadata(): Promise<Metadata> {
  const cookieKey = (await cookies()).get(APP_COOKIE)?.value ?? null;
  if (!cookieKey) return { title: "MY TRAKR" };

  const tenantId = await resolveTenantId(cookieKey);
  const subject = tenantId ? await getDashboardSubject(tenantId) : null;
  return { title: subject ? `MY TRAKR · ${subject}` : "MY TRAKR" };
}


export default async function ProductDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string; device?: string }>;
}) {
  const { key, device } = await searchParams;

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

  const { data, live, locale, tenant, error } = await getProductDashboardData(tenantId ?? "");

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
    // An empty dashboard is exactly when connecting a watch pays off most, so
    // the step is offered here too — but only when the deploy can honour it.
    const link = hasStrava() && tenantId ? await getDeviceLink(tenantId, "strava") : null;
    const stravaState = !hasStrava() ? "off" : link ? "connected" : "ready";
    return (
      <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
        <nav className="mb-4 flex items-center justify-between gap-3 border-b border-[var(--border-soft)] px-1 py-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-trakr.svg" alt="MY TRAKR" className="h-[26px] w-auto" />
          {/* Also here: landing on the wrong account's welcome screen is exactly
              when you most need a way out. */}
          <LogoutButton locale={onboardingLocale} />
        </nav>
        <Onboarding
          locale={onboardingLocale}
          athlete={tenant.athlete}
          connectorUrl={process.env.MCP_CONNECTOR_URL ?? "https://dashboard-treino-zeroventunos-projects.vercel.app/api/mcp?key=SUA_CHAVE"}
          strava={stravaState}
        />
      </div>
    );
  }

  // Say exactly WHY we fell back to mock — silent sample data is impossible to
  // debug. `error` is the case that matters most: a failed read used to draw the
  // same screen as "nothing logged yet", so a missing migration looked exactly
  // like the athlete's data having vanished.
  const reason: TKey | null = live
    ? null
    : !dbConfigured
      ? "app.reason.noDb"
      : error
        ? "app.reason.error"
        : "app.reason.empty";
  const todayISO = toISO(new Date());
  const readiness = data.checkins.at(-1)?.recommendation ?? undefined;

  // Status only — the tokens must never cross into a client component. Hidden
  // entirely when the deploy has no Strava app configured, since a connect
  // button that can only fail is worse than no button.
  const link = live && hasStrava() && tenantId ? await getDeviceLink(tenantId, "strava") : null;
  const showDevice = live && hasStrava();

  return (
    <div data-readiness={readiness} className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <nav className="sticky top-0 z-40 -mx-4 mb-4 flex items-center justify-between gap-3 border-b border-[var(--border-soft)] bg-[rgba(38,43,52,0.82)] px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-trakr.svg" alt="MY TRAKR" className="h-[26px] w-auto" />
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-[5px] text-[11.5px] font-medium text-[var(--text-muted)]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: live ? "var(--good)" : "var(--warn)" }} />
            {live ? tr("common.live") : tenantId ? tr("app.noData") : tr("common.sampleData")}
          </span>
          <AthleteSettings preferences={tenant.preferences ?? {}} locale={locale} editable={live} />
          <AppNotifications briefing={coachBriefing(locale)} briefingVersion={BRIEFING_VERSION} connectorVersion={CONNECTOR_VERSION} locale={locale} />
          <LogoutButton locale={locale} />
        </div>
      </nav>

      {/* Só para quem é dono deste painel: convidar a instalar o app durante o
          drill-in de um treinador instalaria o painel do ALUNO no telefone
          dele. E a demo com dado de exemplo não é o que alguém quer na tela
          inicial. */}
      {live && <InstallPrompt locale={locale} />}

      {!live && reason && (
        <div
          className="mb-4 rounded-[14px] border bg-[var(--surface-2)] px-4 py-3 text-[12.5px] text-[var(--text-muted)]"
          style={{ borderColor: error ? "color-mix(in oklab, var(--bad) 45%, transparent)" : "color-mix(in oklab, var(--warn) 40%, transparent)" }}
        >
          <span className="font-semibold" style={{ color: error ? "var(--bad)" : "var(--warn)" }}>
            {tr("app.sampleBanner")} ·{" "}
          </span>
          {tr(reason)}
          {/* The database's own words. Ugly, and far kinder than letting someone
              conclude their training history is gone. */}
          {error && (
            <code className="mt-1.5 block overflow-x-auto rounded-[8px] bg-[var(--bg-soft)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--text-faint)]">
              {error}
            </code>
          )}
        </div>
      )}

      {showDevice && (
        <DeviceConnect
          connected={!!link}
          lastSyncAt={link?.last_sync_at ?? null}
          lastError={link?.last_error ?? null}
          locale={locale}
          notice={device}
          connectPaused={NEW_CONNECTIONS_PAUSED}
        />
      )}

      {/* The athlete owns this dashboard → they can drag a session to another day.
          `live` guards the sample-data fallback, where a write has nowhere to go. */}
      <DashboardBlocks data={data} tenant={tenant} locale={locale} todayISO={todayISO} editable={live} />

      <footer className="mt-9 text-center">
        <Tagline />
        <p className="mt-1.5 text-[11px] text-[var(--text-faint)]">{tr("app.footer")}</p>
      </footer>
    </div>
  );
}
