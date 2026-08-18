import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getRoster, getRosterLoad, getRosterPlanAhead, getRosterTestDates, resolveStaffId } from "@/lib/product-db";
import { testStatus, needsTesting } from "@/lib/testing";
import { COACH_COOKIE } from "@/app/api/coach-login/route";
import { pickLocale, translator, type Locale } from "@/lib/i18n";
import { todayInZone } from "@/lib/agency-clock";
import { CoachNav } from "@/components/coach/CoachNav";
import { TodoList } from "@/components/coach/TodoList";
import { collectSignals } from "@/lib/coach-signals";
import { RosterBoard } from "@/components/coach/RosterBoard";
import { LoadBar } from "@/components/coach/LoadBar";
import { isLoadBand, viewRosterLoad } from "@/lib/roster-load-view";

export const dynamic = "force-dynamic";

export default async function CoachPanelPage({
  searchParams,
}: {
  /** ?load=<band> filters the grid to one load band. A query string rather than
   * client state: the board's data callbacks can't cross to the client, and a
   * filtered roster is worth being linkable. */
  searchParams: Promise<{ load?: string | string[] }>;
}) {
  const cookieKey = (await cookies()).get(COACH_COOKIE)?.value ?? null;
  if (!cookieKey) redirect("/coach/login");

  const staff = await resolveStaffId(cookieKey);
  if (!staff) redirect("/coach/login?erro=1");

  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);
  // The agency's day, not the server's — which is UTC on Vercel. Everything
  // below hangs off this one string: the load window, the threshold ages, the
  // readiness light and the day's list.
  const todayISO = todayInZone(staff.timezone);
  // Four independent reads rather than one wider roster function: each degrades
  // on its own if its migration hasn't run, so a missing SQL file costs a badge
  // instead of the whole panel.
  const [roster, planAhead, testDates, load] = await Promise.all([
    getRoster(staff.id),
    getRosterPlanAhead(staff.id),
    getRosterTestDates(staff.id),
    getRosterLoad(staff.id, todayISO),
  ]);

  const planByTenant = new Map(planAhead.map((p) => [p.tenant_id, p]));

  // The roster ids, not the load rows, are the denominator: getRosterLoad omits
  // athletes with no sessions, and those are "no reading", not "ok".
  const loadView = viewRosterLoad(roster.map((a) => a.tenant_id), load, todayISO);
  const rawBand = (await searchParams).load;
  const band = isLoadBand(rawBand) ? rawBand : null;
  const shown = band ? roster.filter((a) => loadView.bandFor(a.tenant_id) === band) : roster;

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
    { id: staff.id, agencyId: staff.agencyId, role: staff.role, isOwner: staff.isOwner, timezone: staff.timezone },
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

      {/* Directly above the grid, because it is the grid's header: it counts
          the cards below it and it is the legend for the colours on them. The
          day's list stays first — that answers "what do I do now", this answers
          "what did I write". */}
      {roster.length > 0 && (
        <LoadBar
          counts={loadView.counts}
          total={loadView.total}
          attention={loadView.attention}
          active={band}
          basePath="/coach"
          tr={tr}
        />
      )}

      {roster.length === 0 ? (
        <p className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] px-5 py-8 text-center text-[13.5px] text-[var(--text-faint)]">
          {tr("coach.empty")}
        </p>
      ) : shown.length === 0 ? (
        <p className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] px-5 py-8 text-center text-[13.5px] text-[var(--text-faint)]">
          {tr("coach.load.empty")}
        </p>
      ) : (
        <RosterBoard
          roster={shown}
          locale={locale}
          todayISO={todayISO}
          hrefFor={(a) => `/coach/a/${a.tenant_id}`}
          testsFor={(id) => testsByTenant.get(id) ?? []}
          planFor={(id) => planByTenant.get(id) ?? null}
          loadFor={(id) => loadView.stateFor(id)}
        />
      )}
    </div>
  );
}
