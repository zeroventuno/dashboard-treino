// The team roster grid — cohort sections by phase, each attention-sorted. Shared
// by the real /coach panel and the /coach/demo preview so they look identical;
// the only difference is where a card links (real drill-in vs the athlete demo).
import Link from "next/link";
import { translator, type Locale, type TKey } from "@/lib/i18n";
import { daysBetween } from "@/lib/utils";
import type { RosterAthlete } from "@/lib/product-db";

const RECO_COLOR: Record<string, string> = {
  green: "var(--good)",
  yellow: "var(--warn)",
  red: "var(--bad)",
};

/** Athletes needing attention float to the top: red first, then a stale/no
 * check-in or a recent injury, then everyone else. */
function attentionRank(a: RosterAthlete, todayISO: string): number {
  if (a.today_reco === "red") return 0;
  const stale = a.last_checkin ? daysBetween(a.last_checkin, todayISO) > 3 : true;
  if (a.recent_injuries > 0 || stale) return 1;
  if (a.today_reco === "yellow") return 2;
  return 3;
}

/** Order cohort sections along the training arc; no-cycle lands last. */
function phaseRank(phase: string): number {
  if (!phase) return 5;
  const s = phase.toLowerCase();
  if (s.includes("base")) return 0;
  if (s.includes("build") || s.includes("constru")) return 1;
  if (s.includes("peak") || s.includes("pico") || s.includes("picco")) return 2;
  if (s.includes("taper") || s.includes("polim") || s.includes("afila") || s.includes("scarico") || s.includes("affût")) return 3;
  return 4;
}

const CARD_CLASS =
  "rise tcard flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] p-4 shadow-[var(--shadow)] transition-colors hover:border-[var(--border)]";

function CardBody({ a, todayISO, tr }: { a: RosterAthlete; todayISO: string; tr: (k: TKey) => string }) {
  const reco = a.today_reco ? RECO_COLOR[a.today_reco] : null;
  const raceIn = a.next_race_date ? daysBetween(todayISO, a.next_race_date) : null;
  const checkinAgo = a.last_checkin ? daysBetween(a.last_checkin, todayISO) : null;
  const stale = checkinAgo === null || checkinAgo > 3;

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold text-[var(--text)]">{a.athlete ?? a.name}</p>
          <p className="mt-0.5 truncate text-[12px] text-[var(--text-faint)]">
            {a.next_race_name ?? tr("coach.noRace")}
          </p>
        </div>
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
    </>
  );
}

export function RosterBoard({
  roster,
  locale,
  todayISO,
  hrefFor,
}: {
  roster: RosterAthlete[];
  locale: Locale;
  todayISO: string;
  /** Where a card links; return null for a non-clickable card. */
  hrefFor: (a: RosterAthlete) => string | null;
}) {
  const tr = translator(locale);

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

  return (
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
            {list.map((a) => {
              const href = hrefFor(a);
              return href ? (
                <Link key={a.tenant_id} href={href} className={CARD_CLASS}>
                  <CardBody a={a} todayISO={todayISO} tr={tr} />
                </Link>
              ) : (
                <div key={a.tenant_id} className={CARD_CLASS}>
                  <CardBody a={a} todayISO={todayISO} tr={tr} />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
