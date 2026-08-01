import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getRoster, resolveStaffId, type RosterAthlete } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";
import { pickLocale, translator, type Locale, type TKey } from "@/lib/i18n";
import { daysBetween, toISO } from "@/lib/utils";
import { CoachLogout } from "@/components/coach/CoachLogout";

export const dynamic = "force-dynamic";

const RECO_COLOR: Record<string, string> = {
  green: "var(--good)",
  yellow: "var(--warn)",
  red: "var(--bad)",
};

/** Athletes needing attention float to the top: red first, then a stale/no
 * check-in or a recent injury, then everyone else — so a coach opening the panel
 * sees who to look at without scanning. */
function attentionRank(a: RosterAthlete, todayISO: string): number {
  if (a.today_reco === "red") return 0;
  const stale = a.last_checkin ? daysBetween(a.last_checkin, todayISO) > 3 : true;
  if (a.recent_injuries > 0 || stale) return 1;
  if (a.today_reco === "yellow") return 2;
  return 3;
}

/** Order cohort sections along the training arc. Phase names are free-form (the
 * coach names them, in any language), so match fuzzily; no-cycle lands last. */
function phaseRank(phase: string): number {
  if (!phase) return 5;
  const s = phase.toLowerCase();
  if (s.includes("base")) return 0;
  if (s.includes("build") || s.includes("constru")) return 1;
  if (s.includes("peak") || s.includes("pico") || s.includes("picco")) return 2;
  if (s.includes("taper") || s.includes("polim") || s.includes("afila") || s.includes("scarico") || s.includes("affût")) return 3;
  return 4;
}

function RosterCard({ a, todayISO, tr }: { a: RosterAthlete; todayISO: string; tr: (k: TKey) => string }) {
  const reco = a.today_reco ? RECO_COLOR[a.today_reco] : null;
  const raceIn = a.next_race_date ? daysBetween(todayISO, a.next_race_date) : null;
  const checkinAgo = a.last_checkin ? daysBetween(a.last_checkin, todayISO) : null;
  const stale = checkinAgo === null || checkinAgo > 3;

  return (
    <Link
      href={`/coach/a/${a.tenant_id}`}
      className="rise tcard flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] p-4 shadow-[var(--shadow)] transition-colors hover:border-[var(--border)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold text-[var(--text)]">{a.athlete ?? a.name}</p>
          {a.next_race_name ? (
            <p className="mt-0.5 truncate text-[12px] text-[var(--text-faint)]">{a.next_race_name}</p>
          ) : (
            <p className="mt-0.5 text-[12px] text-[var(--text-faint)]">{tr("coach.noRace")}</p>
          )}
        </div>
        {/* today's traffic-light */}
        <span
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: reco ?? "var(--border)" }}
          title={a.today_reco ?? "—"}
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {raceIn !== null && raceIn >= 0 && (
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-muted)]">
            {raceIn === 0 ? tr("coach.today") : tr("coach.inDays").replace("{n}", String(raceIn))}
          </span>
        )}
        <span
          className="rounded-full border px-2 py-0.5 text-[11px] font-medium"
          style={{
            borderColor: stale ? "var(--warn)" : "var(--border)",
            color: stale ? "var(--warn)" : "var(--text-faint)",
          }}
        >
          {checkinAgo === null
            ? tr("coach.noCheckin")
            : checkinAgo === 0
              ? tr("coach.checkinToday")
              : tr("coach.checkinAgo").replace("{n}", String(checkinAgo))}
        </span>
        {a.recent_injuries > 0 && (
          <span className="rounded-full border border-[var(--bad)] px-2 py-0.5 text-[11px] font-semibold text-[var(--bad)]">
            {tr("coach.injury")}
          </span>
        )}
      </div>
    </Link>
  );
}

export default async function CoachPanelPage() {
  const cookieKey = (await cookies()).get(COACH_COOKIE)?.value ?? null;
  if (!cookieKey) redirect("/coach/login");

  const staff = await resolveStaffId(cookieKey);
  if (!staff) redirect("/coach/login?erro=1");

  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);
  const todayISO = toISO(new Date());

  const roster = await getRoster(staff.id);

  // Group into cohorts by training phase (the unit of batch prescription), each
  // cohort attention-sorted; phase sections follow the training arc.
  const byPhase = new Map<string, RosterAthlete[]>();
  for (const a of roster) {
    const key = a.current_phase ?? "";
    const arr = byPhase.get(key);
    if (arr) arr.push(a);
    else byPhase.set(key, [a]);
  }
  const groups = [...byPhase.entries()]
    .sort(([x], [y]) => phaseRank(x) - phaseRank(y) || x.localeCompare(y))
    .map(([phase, list]) => ({
      phase,
      list: list.sort(
        (m, n) => attentionRank(m, todayISO) - attentionRank(n, todayISO) || m.name.localeCompare(n.name),
      ),
    }));

  const roleLabel = tr(`coach.role.${staff.role}` as TKey);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <nav className="sticky top-0 z-40 -mx-4 mb-5 flex items-center justify-between gap-3 border-b border-[var(--border-soft)] bg-[rgba(38,43,52,0.82)] px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-trakr.svg" alt="MY TRAKR" className="h-[26px] w-auto" />
        <div className="flex items-center gap-2">
          {staff.role === "coach" && (
            <Link
              href="/coach/bank"
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-[5px] text-[11.5px] font-semibold text-[var(--text-muted)] transition-colors hover:border-[var(--text)] hover:text-[var(--text)]"
            >
              {tr("coach.bank.link")}
            </Link>
          )}
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-[5px] text-[11.5px] font-medium text-[var(--text-muted)]">
            {staff.name ? `${staff.name} · ${roleLabel}` : roleLabel}
          </span>
          <CoachLogout locale={locale} />
        </div>
      </nav>

      <header className="mb-5 px-1">
        <h1 className="dsp text-[24px] font-extrabold text-[var(--text)]">{tr("coach.team")}</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">{tr("coach.teamSub")}</p>
      </header>

      {roster.length === 0 ? (
        <p className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] px-5 py-8 text-center text-[13.5px] text-[var(--text-faint)]">
          {tr("coach.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-7">
          {groups.map(({ phase, list }) => (
            <section key={phase || "none"}>
              <div className="mb-2.5 flex items-baseline gap-2 px-1">
                <h2 className="text-[13px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
                  {phase || tr("coach.noPhase")}
                </h2>
                <span className="tnum text-[12px] text-[var(--text-faint)]">{list.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((a) => (
                  <RosterCard key={a.tenant_id} a={a} todayISO={todayISO} tr={tr} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
