// The agency's retention screen: who to call today.
//
// Coach-only for now. There is no `owner` role yet, so this is gated the same
// way the workout bank is — a nutritionist or physio has no business reading the
// whole agency's book. When an owner role lands, tighten this to it.
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
  if (staff.role !== "coach") redirect("/coach");

  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);
  const rows = await getAgencyAttention(staff.agencyId);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <CoachNav active="agency" role={staff.role} name={staff.name} locale={locale} />

      <header className="mb-5 px-1">
        <h1 className="dsp text-[24px] font-extrabold text-[var(--text)]">{tr("agency.title")}</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">{tr("agency.sub")}</p>
      </header>

      <AgencyBoard rows={rows} todayISO={toISO(new Date())} locale={locale} />
    </div>
  );
}
