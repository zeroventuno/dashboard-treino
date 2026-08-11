// Drill-in do painel-mãe: a carteira de UM profissional.
//
// Owner-only por construção — o placar que leva até aqui só existe para o dono,
// e um treinador contratado abrindo a carteira de um colega é outra decisão de
// produto, que não se toma por acidente. O escopo por `agencyId` também é a
// fronteira de autorização: um staffId de outra assessoria simplesmente não
// aparece na lista e cai em 404.
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { resolveStaffId, getAgencyAttention, listStaff } from "@/lib/product-db";
import { assess } from "@/lib/retention";
import { scoreCoach, type StaffInfo } from "@/lib/agency-metrics";
import { COACH_COOKIE } from "@/app/api/coach-login/route";
import { pickLocale, translator, type Locale, type TKey } from "@/lib/i18n";
import { CoachNav } from "@/components/coach/CoachNav";
import { AgencyBoard } from "@/components/coach/AgencyBoard";
import { toISO } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function CoachBookPage({ params }: { params: Promise<{ staffId: string }> }) {
  const cookieKey = (await cookies()).get(COACH_COOKIE)?.value ?? null;
  if (!cookieKey) redirect("/coach/login");

  const staff = await resolveStaffId(cookieKey);
  if (!staff) redirect("/coach/login?erro=1");
  if (!staff.isOwner) redirect("/coach/agency");

  const { staffId } = await params;
  const member = (await listStaff(staff.agencyId)).find((m) => m.id === staffId);
  if (!member) notFound();

  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);
  const todayISO = toISO(new Date());

  const book = (await getAgencyAttention(staff.agencyId)).filter((r) => r.staff_ids.includes(staffId));
  const info: StaffInfo = {
    id: member.id, name: member.name, role: member.role, isOwner: member.is_owner,
    maxAthletes: member.max_athletes, payModel: member.pay_model, payValue: member.pay_value,
  };
  const score = scoreCoach(info, book.map((r) => assess(r, todayISO)));
  const money = (v: number | null) =>
    v == null ? "—" : `${staff.currency} ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <CoachNav active="agency" role={staff.role} name={staff.name} locale={locale} isOwner={staff.isOwner} />

      <header className="mb-5 px-1">
        <Link href="/coach/agency" className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]">
          ← {tr("agency.title")}
        </Link>
        <h1 className="dsp mt-1 text-[24px] font-extrabold text-[var(--text)]">{score.name}</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">{tr(`coach.role.${member.role}` as TKey)}</p>
      </header>

      <section className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={tr("agency.k.athletes")} value={String(score.athletes)} />
        <Stat label={tr("agency.k.revenue")} value={money(score.revenue)} />
        <Stat label={tr("agency.m.margin")} value={money(score.margin)} />
        <Stat
          label={tr("agency.m.load")}
          // Sem alvo declarado a ocupação é desconhecida, não zero — mostrar
          // "0%" faria uma carteira cheia parecer vazia.
          value={score.load == null ? "—" : `${Math.round(score.load * 100)}%`}
        />
      </section>

      <AgencyBoard
        rows={book}
        todayISO={todayISO}
        locale={locale}
        showMoney
        showStaffBreakdown={false}
        currency={staff.currency}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2.5">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">{label}</p>
      <p className="mt-0.5 text-[19px] font-extrabold text-[var(--text)]">{value}</p>
    </div>
  );
}
