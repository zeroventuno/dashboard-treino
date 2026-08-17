// Public preview of the coach panel — mock roster, no login, no database. Same
// RosterBoard the real /coach uses, so it looks identical; cards link to the
// athlete /demo so you can walk the whole thing without provisioning anything.
//
// The cohort itself lives in lib/demo-roster.ts, which is a TEST BED before it
// is a preview: nine athletes chosen to put every state the panel can show on
// screen at once. Read the header there before touching the numbers.
import Link from "next/link";
import { headers } from "next/headers";
import { pickLocale, translator, type Locale } from "@/lib/i18n";
import { toISO } from "@/lib/utils";
import { demoRosterBoard } from "@/lib/demo-roster";
import { CoachNav } from "@/components/coach/CoachNav";
import { RosterBoard } from "@/components/coach/RosterBoard";
import { LoadBar } from "@/components/coach/LoadBar";
import { isLoadBand, viewRosterLoad } from "@/lib/roster-load-view";

export const dynamic = "force-dynamic";

export default async function CoachDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ load?: string | string[] }>;
}) {
  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);
  const todayISO = toISO(new Date());
  // Same four inputs the real panel feeds the board — roster, plan reach,
  // threshold ages and PMC load — so the preview exercises the empty-calendar
  // ranking, the test badges and the fatigue marks rather than only the half of
  // the card that needs no migration.
  const { roster, planFor, testsFor, load } = demoRosterBoard(todayISO);

  // Identical to app/coach/page.tsx, deliberately: the fixture must go through
  // the same classifier and the same denominator rule the real panel uses.
  const loadView = viewRosterLoad(roster.map((a) => a.tenant_id), load, todayISO);
  const rawBand = (await searchParams).load;
  const band = isLoadBand(rawBand) ? rawBand : null;
  const shown = band ? roster.filter((a) => loadView.bandFor(a.tenant_id) === band) : roster;

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <CoachNav role="coach" locale={locale} demo />

      <header className="mb-5 px-1">
        <h1 className="dsp text-[24px] font-extrabold text-[var(--text)]">{tr("coach.team")}</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">
          {tr("coach.teamSub")} · <span className="text-[var(--text-muted)]">dados de exemplo</span>
        </p>
      </header>

      <LoadBar
        counts={loadView.counts}
        total={loadView.total}
        attention={loadView.attention}
        active={band}
        basePath="/coach/demo"
        tr={tr}
      />

      {shown.length === 0 ? (
        <p className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] px-5 py-8 text-center text-[13.5px] text-[var(--text-faint)]">
          {tr("coach.load.empty")}
        </p>
      ) : (
        <RosterBoard
          roster={shown}
          locale={locale}
          todayISO={todayISO}
          hrefFor={() => "/demo"}
          testsFor={testsFor}
          planFor={planFor}
          loadFor={(id) => loadView.stateFor(id)}
        />
      )}

      <p className="mt-8 text-center text-[12px] text-[var(--text-faint)]">
        Prévia com dados fictícios · <Link href="/coach/login" className="text-[var(--lime)] hover:underline">entrar no painel real</Link>
      </p>
    </div>
  );
}
