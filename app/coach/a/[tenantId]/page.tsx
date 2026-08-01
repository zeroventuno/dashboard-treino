// A professional's read-only drill-in on ONE athlete from their roster. Reuses
// the exact block grid from /app (DashboardBlocks) — same view the athlete sees,
// just reached through the coach panel and gated by roster membership.
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveStaffId, staffCanAccess } from "@/lib/product-db";
import { getProductDashboardData } from "@/lib/data-product";
import { COACH_COOKIE } from "@/app/api/coach-login/route";
import { DashboardBlocks } from "@/components/DashboardBlocks";
import { pickLocale, translator, type Locale } from "@/lib/i18n";
import { toISO } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CoachAthletePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const cookieKey = (await cookies()).get(COACH_COOKIE)?.value ?? null;
  if (!cookieKey) redirect("/coach/login");

  const staff = await resolveStaffId(cookieKey);
  if (!staff) redirect("/coach/login?erro=1");

  const { tenantId } = await params;
  // Authorization: only an athlete on THIS staff member's roster can be opened.
  if (!(await staffCanAccess(staff.id, tenantId))) redirect("/coach");

  const navLocale: Locale = pickLocale((await headers()).get("accept-language"));
  const trNav = translator(navLocale);

  const { data, tenant, locale } = await getProductDashboardData(tenantId);
  const todayISO = toISO(new Date());
  const readiness = data.checkins.at(-1)?.recommendation ?? undefined;
  const title = tenant.athlete ?? tenant.raceName ?? "";

  return (
    <div data-readiness={readiness} className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <nav className="sticky top-0 z-40 -mx-4 mb-4 flex items-center justify-between gap-3 border-b border-[var(--border-soft)] bg-[rgba(38,43,52,0.82)] px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <Link
          href="/coach"
          className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        >
          <span aria-hidden>←</span> {trNav("coach.team")}
        </Link>
        {title && (
          <span className="truncate rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-[5px] text-[11.5px] font-medium text-[var(--text-muted)]">
            {title}
          </span>
        )}
      </nav>

      <DashboardBlocks data={data} tenant={tenant} locale={locale} todayISO={todayISO} />
    </div>
  );
}
