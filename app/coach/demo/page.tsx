// Public preview of the coach panel — mock roster, no login, no database. Same
// RosterBoard the real /coach uses, so it looks identical; cards link to the
// athlete /demo so you can walk the whole thing without provisioning anything.
import Link from "next/link";
import { headers } from "next/headers";
import { pickLocale, translator, type Locale } from "@/lib/i18n";
import { toISO, addDays } from "@/lib/utils";
import type { RosterAthlete } from "@/lib/product-db";
import { RosterBoard } from "@/components/coach/RosterBoard";

export const dynamic = "force-dynamic";

/** A varied sample squad: several phases, the full range of readiness lights,
 * a couple of stale check-ins and injuries — so every state the panel can show
 * is on screen. Dates are relative to now, so countdowns look live. */
function mockRoster(): RosterAthlete[] {
  const race = (n: number) => toISO(addDays(new Date(), n));
  const ago = (n: number) => toISO(addDays(new Date(), -n));
  const a = (
    id: string,
    athlete: string,
    current_phase: string | null,
    today_reco: RosterAthlete["today_reco"],
    opts: Partial<RosterAthlete> = {},
  ): RosterAthlete => ({
    tenant_id: id,
    name: athlete,
    athlete,
    mode: "race",
    current_phase,
    next_race_name: null,
    next_race_date: null,
    today_reco,
    last_checkin: ago(0),
    recent_injuries: 0,
    ...opts,
  });

  return [
    a("d1", "Marina", "Base", "green", { next_race_name: "IRONMAN 70.3 Cascais", next_race_date: race(96) }),
    a("d2", "João", "Base", "yellow", { next_race_name: "Maratona do Porto", next_race_date: race(96), last_checkin: ago(1) }),
    a("d3", "Lucas", "Base", "red", { last_checkin: ago(1), recent_injuries: 1 }),
    a("d4", "Ana", "Build", "green", { next_race_name: "Triatlo de Aveiro", next_race_date: race(42) }),
    a("d5", "Pedro", "Build", null, { last_checkin: ago(5) }),
    a("d6", "Carla", "Build", "yellow", { next_race_name: "Triatlo de Aveiro", next_race_date: race(42), last_checkin: ago(2), recent_injuries: 1 }),
    a("d7", "Rafael", "Pico", "green", { next_race_name: "IRONMAN 70.3 Cascais", next_race_date: race(13) }),
    a("d8", "Bia", "Taper", "green", { next_race_name: "Meia de Lisboa", next_race_date: race(5) }),
    a("d9", "Diego", null, null, { last_checkin: ago(8) }),
  ];
}

export default async function CoachDemoPage() {
  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);
  const todayISO = toISO(new Date());

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <nav className="sticky top-0 z-40 -mx-4 mb-5 flex items-center justify-between gap-3 border-b border-[var(--border-soft)] bg-[rgba(38,43,52,0.82)] px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-trakr.svg" alt="MY TRAKR" className="h-[26px] w-auto" />
        <span className="rounded-full border border-[var(--lime)] px-2.5 py-[5px] text-[11px] font-bold uppercase tracking-wide text-[var(--lime)]">
          Demo
        </span>
      </nav>

      <header className="mb-5 px-1">
        <h1 className="dsp text-[24px] font-extrabold text-[var(--text)]">{tr("coach.team")}</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">
          {tr("coach.teamSub")} · <span className="text-[var(--text-muted)]">dados de exemplo</span>
        </p>
      </header>

      <RosterBoard roster={mockRoster()} locale={locale} todayISO={todayISO} hrefFor={() => "/demo"} />

      <p className="mt-8 text-center text-[12px] text-[var(--text-faint)]">
        Prévia com dados fictícios · <Link href="/coach/login" className="text-[var(--lime)] hover:underline">entrar no painel real</Link>
      </p>
    </div>
  );
}
