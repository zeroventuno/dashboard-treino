import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getRoster, getRosterPlanAhead, getRosterTestDates, resolveStaffId } from "@/lib/product-db";
import { testStatus, needsTesting } from "@/lib/testing";
import { COACH_COOKIE } from "@/app/api/coach-login/route";
import { pickLocale, translator, type Locale } from "@/lib/i18n";
import { toISO } from "@/lib/utils";
import { CoachNav } from "@/components/coach/CoachNav";
import { TodoList } from "@/components/coach/TodoList";
import { collectSignals } from "@/lib/coach-signals";
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
  // Three independent reads rather than one wider roster function: each degrades
  // on its own if its migration hasn't run, so a missing SQL file costs a badge
  // instead of the whole panel.
  const [roster, planAhead, testDates] = await Promise.all([
    getRoster(staff.id),
    getRosterPlanAhead(staff.id),
    getRosterTestDates(staff.id),
  ]);

  const planByTenant = new Map(planAhead.map((p) => [p.tenant_id, p]));

  // Threshold ages become the same shape the athlete's own dashboard uses, so
  // "overdue" means one thing in one place.
  //
  // Tested against what each athlete ACTUALLY trains, not a fixed trio. The
  // three disciplines used to be hardcoded here while `sports` sat unread on
  // the same roster row, so a runner was told their swim threshold had never
  // been tested and a non-swimming cyclist carried a red badge for a pool they
  // never enter. Seven of nine athletes in the demo cohort wore a test badge,
  // which turned the loudest mark on the card into wallpaper.
  //
  // Empty `sports` still means "nothing declared", never "none" — the house
  // rule everywhere else — so those athletes keep all three. We don't know what
  // they train, and reminding about a test they don't need is better than
  // staying silent about one they do.
  const sportsByTenant = new Map(roster.map((a) => [a.tenant_id, a.sports ?? []]));
  const testsByTenant = new Map(
    testDates.map((t) => {
      const declared = sportsByTenant.get(t.tenant_id) ?? [];
      const trained = (["bike", "run", "swim"] as const).filter(
        (d) => declared.length === 0 || declared.includes(d),
      );
      return [
        t.tenant_id,
        needsTesting(
          testStatus(
            [
              ...(t.ftp_at ? [{ id: "f", date: t.ftp_at, metric: "FTP", value: null, unit: null, notes: null }] : []),
              ...(t.run_at ? [{ id: "r", date: t.run_at, metric: "run_pace_threshold", value: null, unit: null, notes: null }] : []),
              ...(t.swim_at ? [{ id: "s", date: t.swim_at, metric: "swim_pace_100m", value: null, unit: null, notes: null }] : []),
            ],
            trained,
            todayISO,
          ),
        ),
      ];
    }),
  );

  const signals = await collectSignals(
    { id: staff.id, agencyId: staff.agencyId, role: staff.role, isOwner: staff.isOwner },
    locale,
  );

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <CoachNav active="team" role={staff.role} name={staff.name} locale={locale} isOwner={staff.isOwner} />

      <header className="mb-5 px-1">
        <h1 className="dsp text-[24px] font-extrabold text-[var(--text)]">{tr("coach.team")}</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">{tr("coach.teamSub")}</p>
      </header>

      {/* A lista do dia ANTES da equipe, de propósito: abrir a ferramenta tem
          que já responder "o que eu faço hoje". Cortada em cinco — aqui ela é
          chamado à ação, não o conteúdo da página. */}
      {signals.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
            {tr("coach.notif.today")}
          </h2>
          <TodoList signals={signals} tr={tr} limit={5} />
        </section>
      )}

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
          testsFor={(id) => testsByTenant.get(id) ?? []}
          planFor={(id) => planByTenant.get(id) ?? null}
        />
      )}
    </div>
  );
}
