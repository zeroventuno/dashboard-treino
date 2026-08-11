// Redistribuir a carteira: cards de aluno dentro do bloco de cada profissional.
// Owner-only — repartir o trabalho da assessoria é decisão de dono.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { resolveStaffId, getAgencyAttention, listStaff } from "@/lib/product-db";
import { assess } from "@/lib/retention";
import type { StaffInfo } from "@/lib/agency-metrics";
import { COACH_COOKIE } from "@/app/api/coach-login/route";
import { pickLocale, translator, type Locale } from "@/lib/i18n";
import { CoachNav } from "@/components/coach/CoachNav";
import { RosterAllocation, type BoardAthlete } from "@/components/coach/RosterAllocation";
import { toISO } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function RosterPage() {
  const cookieKey = (await cookies()).get(COACH_COOKIE)?.value ?? null;
  if (!cookieKey) redirect("/coach/login");

  const staff = await resolveStaffId(cookieKey);
  if (!staff) redirect("/coach/login?erro=1");
  if (!staff.isOwner) redirect("/coach/agency");

  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);
  const todayISO = toISO(new Date());

  const [team, rows] = await Promise.all([
    listStaff(staff.agencyId).then((t) => t.filter((m) => m.status === "active")),
    getAgencyAttention(staff.agencyId),
  ]);

  const info: StaffInfo[] = team.map((m) => ({
    id: m.id, name: m.name, role: m.role, isOwner: m.is_owner, sports: m.sports,
    maxAthletes: m.max_athletes, payModel: m.pay_model, payValue: m.pay_value,
  }));

  const athletes: BoardAthlete[] = rows.map((r) => {
    const a = assess(r, todayISO);
    return {
      tenantId: r.tenant_id,
      name: r.name,
      state: a.state,
      monthlyValue: r.monthly_value,
      // Vazio por ora: as modalidades que o atleta treina são leitura
      // cross-tenant e exigem uma SECURITY DEFINER própria. O quadro funciona
      // sem — só não sugere sozinho quem combina com quem.
      sports: [],
    };
  });

  // Um aluno pode estar em mais de uma carteira (treino + nutrição + fisio), e
  // isso é legítimo — o quadro mostra cada bloco como ele é, e mover de um não
  // mexe nos outros.
  const assignment: Record<string, string[]> = Object.fromEntries(
    team.map((m) => [m.id, rows.filter((r) => r.staff_ids.includes(m.id)).map((r) => r.tenant_id)]),
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-16 sm:px-6">
      <CoachNav active="agency" role={staff.role} name={staff.name} locale={locale} isOwner={staff.isOwner} />

      <header className="mb-5 px-1">
        <Link href="/coach/agency" className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]">
          ← {tr("agency.title")}
        </Link>
        <h1 className="dsp mt-1 text-[24px] font-extrabold text-[var(--text)]">{tr("roster.title")}</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">{tr("roster.sub")}</p>
      </header>

      <RosterAllocation
        staff={info}
        athletes={athletes}
        assignment={assignment}
        currency={staff.currency}
        locale={locale}
      />
    </div>
  );
}
