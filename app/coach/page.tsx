import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getRoster, resolveStaffId } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";
import { pickLocale, translator, type Locale, type TKey } from "@/lib/i18n";
import { toISO } from "@/lib/utils";
import { CoachLogout } from "@/components/coach/CoachLogout";
import { RosterBoard } from "@/components/coach/RosterBoard";

export const dynamic = "force-dynamic";

export default async function CoachPanelPage() {
  const cookieKey = (await cookies()).get(COACH_COOKIE)?.value ?? null;
  if (!cookieKey) redirect("/coach/login");

  const staff = await resolveStaffId(cookieKey);
  if (!staff) redirect("/coach/login?erro=1");

  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);
  const todayISO = toISO(new Date());
  const roster = await getRoster(staff.id);
  const roleLabel = tr(`coach.role.${staff.role}` as TKey);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <nav className="sticky top-0 z-40 -mx-4 mb-5 flex items-center justify-between gap-3 border-b border-[var(--border-soft)] bg-[rgba(38,43,52,0.82)] px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-trakr.svg" alt="MY TRAKR" className="h-[26px] w-auto" />
        <div className="flex items-center gap-2">
          {staff.role === "coach" && (
            <Link
              href="/coach/bank"
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-[5px] text-[11.5px] font-semibold text-[var(--text-muted)] transition-colors hover:border-[var(--text)] hover:text-[var(--text)]"
            >
              {tr("coach.bank.link")}
            </Link>
          )}
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-[5px] text-[11.5px] font-medium text-[var(--text-muted)]">
            {staff.name ? `${staff.name} · ${roleLabel}` : roleLabel}
          </span>
          <CoachLogout locale={locale} />
        </div>
      </nav>

      <header className="mb-5 px-1">
        <h1 className="dsp text-[24px] font-extrabold text-[var(--text)]">{tr("coach.team")}</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">{tr("coach.teamSub")}</p>
      </header>

      {roster.length === 0 ? (
        <p className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] px-5 py-8 text-center text-[13.5px] text-[var(--text-faint)]">
          {tr("coach.empty")}
        </p>
      ) : (
        <RosterBoard
          roster={roster}
          locale={locale}
          todayISO={todayISO}
          hrefFor={(a) => `/coach/a/${a.tenant_id}`}
        />
      )}
    </div>
  );
}
