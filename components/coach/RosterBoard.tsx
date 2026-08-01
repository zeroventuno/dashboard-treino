// The team roster grid — cohort sections by phase, each attention-sorted. Shared
// by the real /coach panel and the /coach/demo preview so they look identical.
// Dense cards for big squads: name prominent, modality icons (lit for what the
// athlete trains), and the readiness light carried by the card's border + glow
// rather than a fill, so a red athlete quietly draws the eye.
import Link from "next/link";
import { translator, type Locale, type TKey } from "@/lib/i18n";
import { daysBetween } from "@/lib/utils";
import type { RosterAthlete } from "@/lib/product-db";

const FAROL: Record<string, string> = {
  green: "var(--good)",
  yellow: "var(--warn)",
  red: "var(--bad)",
};

const MODS: { key: string; icon: string }[] = [
  { key: "swim", icon: "🏊" },
  { key: "bike", icon: "🚴" },
  { key: "run", icon: "🏃" },
  { key: "strength", icon: "💪" },
];

/** Attention: red first, then a stale/no check-in or a recent injury, then the rest. */
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

function Card({ a, todayISO, tr, href }: { a: RosterAthlete; todayISO: string; tr: (k: TKey) => string; href: string | null }) {
  const farol = a.today_reco ? FAROL[a.today_reco] : null;
  const raceIn = a.next_race_date ? daysBetween(todayISO, a.next_race_date) : null;
  const checkinAgo = a.last_checkin ? daysBetween(a.last_checkin, todayISO) : null;
  const stale = checkinAgo === null || checkinAgo > 3;
  const sports = a.sports ?? [];

  const cls =
    "flex flex-col gap-1 rounded-[12px] border bg-[var(--surface)] px-3 py-2.5 transition-colors hover:bg-[var(--surface-2)]";
  // The readiness light lives in the border + a faint outer glow, not a fill.
  const style: React.CSSProperties = {
    borderColor: farol ?? "var(--border-soft)",
    boxShadow: farol ? `0 0 16px -9px ${farol}` : undefined,
  };

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[14px] font-bold leading-tight text-[var(--text)]">{a.athlete ?? a.name}</p>
        <span className="flex shrink-0 items-center gap-[3px] text-[12.5px] leading-none">
          {MODS.map((m) => {
            const on = sports.includes(m.key);
            return (
              <span
                key={m.key}
                title={m.key}
                style={{ opacity: on ? 1 : 0.22, filter: on ? "none" : "grayscale(1)" }}
              >
                {m.icon}
              </span>
            );
          })}
        </span>
      </div>

      <div className="flex items-baseline gap-1.5 text-[11px] leading-tight text-[var(--text-faint)]">
        <span className="min-w-0 truncate">{a.next_race_name ?? tr("coach.noRace")}</span>
        {raceIn !== null && raceIn >= 0 && (
          <span className="shrink-0 font-semibold text-[var(--text-muted)]">
            · {raceIn === 0 ? tr("coach.today") : tr("coach.inDays").replace("{n}", String(raceIn))}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-[10.5px] font-medium" style={{ color: stale ? "var(--warn)" : "var(--text-faint)" }}>
          {checkinAgo === null
            ? tr("coach.noCheckin")
            : checkinAgo === 0
              ? tr("coach.checkinToday")
              : tr("coach.checkinAgo").replace("{n}", String(checkinAgo))}
        </span>
        {a.recent_injuries > 0 && (
          <span className="rounded-full border border-[var(--bad)] px-1.5 text-[9px] font-bold uppercase leading-[15px] text-[var(--bad)]">
            {tr("coach.injury")}
          </span>
        )}
      </div>
    </>
  );

  return href ? (
    <Link href={href} className={cls} style={style}>
      {body}
    </Link>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
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
    <div className="flex flex-col gap-6">
      {groups.map(({ phase, list }) => (
        <section key={phase || "none"}>
          <div className="mb-2 flex items-baseline gap-2 px-1">
            <h2 className="text-[12.5px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
              {phase || tr("coach.noPhase")}
            </h2>
            <span className="tnum text-[11.5px] text-[var(--text-faint)]">{list.length}</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {list.map((a) => (
              <Card key={a.tenant_id} a={a} todayISO={todayISO} tr={tr} href={hrefFor(a)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
