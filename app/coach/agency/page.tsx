// The retention screen: who to call today.
//
// Two scopes, one page. An OWNER gets the macro view — every athlete of the
// agency, the breakdown per professional, and the monthly value at risk. Any
// other professional gets the micro view: their own book only, and no money,
// because what the agency charges isn't theirs to see.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveStaffId, getAgencyAttention } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";
import { pickLocale, translator, type Locale } from "@/lib/i18n";
import { CoachNav } from "@/components/coach/CoachNav";
import { AgencyBoard } from "@/components/coach/AgencyBoard";
import { toISO } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CoachAgencyPage() {
  const cookieKey = (await cookies()).get(COACH_COOKIE)?.value ?? null;
  if (!cookieKey) redirect("/coach/login");

  const staff = await resolveStaffId(cookieKey);
  if (!staff) redirect("/coach/login?erro=1");

  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);

  const all = await getAgencyAttention(staff.agencyId);
  // Micro view: the same rows, narrowed to this professional's own roster.
  const rows = staff.isOwner ? all : all.filter((r) => r.staff_ids.includes(staff.id));

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <CoachNav active="agency" role={staff.role} name={staff.name} locale={locale} isOwner={staff.isOwner} />

      <header className="mb-5 px-1">
        <h1 className="dsp text-[24px] font-extrabold text-[var(--text)]">
          {staff.isOwner ? tr("agency.title") : tr("agency.myBook")}
        </h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">{tr("agency.sub")}</p>
      </header>

      <AgencyBoard
        rows={rows}
        todayISO={toISO(new Date())}
        locale={locale}
        // Money and the per-professional breakdown are an ownership view.
        showMoney={staff.isOwner}
        showStaffBreakdown={staff.isOwner}
        currency={staff.currency}
      />
    </div>
  );
}
