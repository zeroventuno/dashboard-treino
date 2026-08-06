import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getRoster, resolveStaffId } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";
import { pickLocale, translator, type Locale } from "@/lib/i18n";
import { toISO } from "@/lib/utils";
import { CoachNav } from "@/components/coach/CoachNav";
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

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <CoachNav active="team" role={staff.role} name={staff.name} locale={locale} isOwner={staff.isOwner} />

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
