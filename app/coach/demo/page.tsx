// Public preview of the coach panel — mock roster, no login, no database. Same
// RosterBoard the real /coach uses, so it looks identical; cards link to the
// athlete /demo so you can walk the whole thing without provisioning anything.
import Link from "next/link";
import { headers } from "next/headers";
import { pickLocale, translator, type Locale } from "@/lib/i18n";
import { toISO, addDays } from "@/lib/utils";
import type { RosterAthlete } from "@/lib/product-db";
import { CoachNav } from "@/components/coach/CoachNav";
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
    sports: ["run"],
    metrics: ["hrv"],
    next_race_name: null,
    next_race_date: null,
    today_reco,
    last_checkin: ago(0),
    recent_injuries: 0,
    injury_severity: null,
    ...opts,
  });

  return [
    a("d1", "Marina", "Base", "green", { sports: ["swim", "bike", "run"], metrics: ["power", "hrv", "bioimpedance"], next_race_name: "IRONMAN 70.3 Cascais", next_race_date: race(96) }),
    a("d2", "João", "Base", "yellow", { sports: ["run", "strength"], metrics: ["hrv"], next_race_name: "Maratona do Porto", next_race_date: race(96), last_checkin: ago(1) }),
    a("d3", "Lucas", "Base", "red", { sports: ["run"], metrics: [], last_checkin: ago(1), recent_injuries: 1, injury_severity: 4 }),
    a("d4", "Ana", "Build", "green", { sports: ["swim", "bike", "run", "strength"], metrics: ["power", "hrv", "bioimpedance"], next_race_name: "Triatlo de Aveiro", next_race_date: race(42) }),
    a("d5", "Pedro", "Build", null, { sports: ["bike", "run"], metrics: ["power", "hrv"], last_checkin: ago(5) }),
    a("d6", "Carla", "Build", "yellow", { sports: ["swim", "bike", "run"], metrics: ["hrv", "bioimpedance"], next_race_name: "Triatlo de Aveiro", next_race_date: race(42), last_checkin: ago(2), recent_injuries: 1, injury_severity: 2 }),
    a("d7", "Rafael", "Pico", "green", { sports: ["swim", "bike", "run"], metrics: ["power", "hrv", "bioimpedance"], next_race_name: "IRONMAN 70.3 Cascais", next_race_date: race(13) }),
    a("d8", "Bia", "Taper", "green", { sports: ["run"], metrics: ["hrv"], next_race_name: "Meia de Lisboa", next_race_date: race(5) }),
    a("d9", "Diego", null, null, { sports: ["bike"], metrics: ["power"], last_checkin: ago(8) }),
  ];
}

export default async function CoachDemoPage() {
  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);
  const todayISO = toISO(new Date());

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <CoachNav role="coach" locale={locale} demo />

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
