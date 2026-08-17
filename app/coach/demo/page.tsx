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

export const dynamic = "force-dynamic";

export default async function CoachDemoPage() {
  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);
  const todayISO = toISO(new Date());
  // Same three inputs the real panel feeds the board — roster, plan reach and
  // threshold ages — so the preview exercises the empty-calendar ranking and the
  // test badges rather than only the half of the card that needs no migration.
  const { roster, planFor, testsFor } = demoRosterBoard(todayISO);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <CoachNav role="coach" locale={locale} demo />

      <header className="mb-5 px-1">
        <h1 className="dsp text-[24px] font-extrabold text-[var(--text)]">{tr("coach.team")}</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">
          {tr("coach.teamSub")} · <span className="text-[var(--text-muted)]">dados de exemplo</span>
        </p>
      </header>

      <RosterBoard
        roster={roster}
        locale={locale}
        todayISO={todayISO}
        hrefFor={() => "/demo"}
        testsFor={testsFor}
        planFor={planFor}
      />

      <p className="mt-8 text-center text-[12px] text-[var(--text-faint)]">
        Prévia com dados fictícios · <Link href="/coach/login" className="text-[var(--lime)] hover:underline">entrar no painel real</Link>
      </p>
    </div>
  );
}
