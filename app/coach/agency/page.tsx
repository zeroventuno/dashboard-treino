// The retention screen: who to call today.
//
// Two scopes, one page. An OWNER gets the macro view — every athlete of the
// agency, the breakdown per professional, and the monthly value at risk. Any
// other professional gets the micro view: their own book only, and no money,
// because what the agency charges isn't theirs to see.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveStaffId, getAgencyAttention, listStaff } from "@/lib/product-db";
import { assess } from "@/lib/retention";
import { scoreAgency, agencyRollup, type StaffInfo } from "@/lib/agency-metrics";
import { AgencyScoreboard } from "@/components/coach/AgencyScoreboard";
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

  // The scoreboard is the OWNER's grain: one row per professional. A hired
  // coach comparing themselves against colleagues' revenue is a different
  // product decision, and not one to make by accident.
  const todayISO = toISO(new Date());
  let board = null;
  if (staff.isOwner) {
    const team = (await listStaff(staff.agencyId)).filter((m) => m.status === "active");
    // One athlete can sit in several books (coach + nutritionist + physio), so
    // this deliberately double-counts across professionals: each book is scored
    // as what that person carries, which is the question being asked. The
    // agency-wide athlete count in the rollup therefore is NOT a headcount —
    // the KPI card reads it from the attention rows instead.
    const books = new Map(
      team.map((m) => [m.id, all.filter((r) => r.staff_ids.includes(m.id)).map((r) => assess(r, todayISO))]),
    );
    const info: StaffInfo[] = team.map((m) => ({
      id: m.id, name: m.name, role: m.role, isOwner: m.is_owner,
      maxAthletes: m.max_athletes, payModel: m.pay_model, payValue: m.pay_value,
    }));
    const scores = scoreAgency(info, books);
    board = {
      scores,
      rollup: { ...agencyRollup(scores), athletes: all.length },
    };
  }

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <CoachNav active="agency" role={staff.role} name={staff.name} locale={locale} isOwner={staff.isOwner} />

      <header className="mb-5 px-1">
        <h1 className="dsp text-[24px] font-extrabold text-[var(--text)]">
          {staff.isOwner ? tr("agency.title") : tr("agency.myBook")}
        </h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">{tr("agency.sub")}</p>
      </header>

      {board && (
        <AgencyScoreboard
          rows={board.scores}
          rollup={board.rollup}
          currency={staff.currency}
          locale={locale}
        />
      )}

      <AgencyBoard
        rows={rows}
        todayISO={todayISO}
        locale={locale}
        // Money and the per-professional breakdown are an ownership view.
        showMoney={staff.isOwner}
        showStaffBreakdown={staff.isOwner}
        currency={staff.currency}
      />
    </div>
  );
}
