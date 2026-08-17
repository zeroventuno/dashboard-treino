// The team roster grid — cohort sections by phase, each attention-sorted. Shared
// by the real /coach panel and the /coach/demo preview so they look identical.
// Dense cards for big squads: name prominent, modality icons (lit for what the
// athlete trains), and the readiness light carried by the card's border + glow
// rather than a fill, so a red athlete quietly draws the eye.
//
// The light has FOUR states, not three. Green/yellow/red are what the athlete
// reported; a missing reading is UNKNOWN, and it gets its own language — a
// dashed border and a hollow chip, in neutral grey — because absence is not
// alarm. Painting a silent athlete red would say "do not train hard today",
// which is a claim about someone who has told us nothing. Same reasoning as
// `never` in lib/testing.ts and z0 in lib/zone-time.ts: not-measured is a state,
// not a low value. See `silent` in Card().
import Link from "next/link";
import type { TestStatus } from "@/lib/testing";
import type { RosterPlanAhead } from "@/lib/product-db";
import { translator, type Locale, type TKey } from "@/lib/i18n";
import { sevColor } from "@/components/InjuryTracker";
import { daysBetween } from "@/lib/utils";
import type { RosterAthlete } from "@/lib/product-db";
import { Icon, type IconName } from "./icons";

const FAROL: Record<string, string> = {
  green: "var(--good)",
  yellow: "var(--warn)",
  red: "var(--bad)",
};

const MODS: IconName[] = ["swim", "bike", "run", "strength"];

// Capability flags → icon. The card lights the ones the athlete declared.
const METRICS: { key: string; icon: IconName }[] = [
  { key: "power", icon: "power" },
  { key: "hrv", icon: "hr" },
  { key: "bioimpedance", icon: "scale" },
];

/** Attention: red first, then a stale/no check-in or a recent injury, then the rest. */
function attentionRank(a: RosterAthlete, todayISO: string, plan?: RosterPlanAhead | null): number {
  // An empty calendar outranks a red light. A red day is information the coach
  // acts on today; an athlete with nothing scheduled is a client quietly
  // receiving no service, and every day it goes unnoticed is a day they spend
  // deciding whether to stay.
  if (plan && plan.planned_7d === 0) return -1;
  if (a.today_reco === "red") return 0;
  const stale = a.last_checkin ? daysBetween(a.last_checkin, todayISO) > 3 : true;
  if (a.recent_injuries > 0 || stale) return 1;
  if (a.today_reco === "yellow") return 2;
  // Running out inside a fortnight is not urgent, but it is the last quiet
  // moment before it becomes the case above.
  if (plan && planRunningOut(plan)) return 2;
  return 3;
}

/**
 * Is the plan about to run out?
 *
 * The question is what sits in days 8-14, not how many sessions exist in the
 * fortnight overall. The old rule compared `planned_14d` against a constant,
 * which meant an athlete with three sessions this week and nothing at all next
 * week scored 3 and stayed silent, while one with two and nothing warned. The
 * busier athlete had exactly the same empty second week — the absolute count
 * was measuring the wrong thing.
 */
function planRunningOut(plan: RosterPlanAhead): boolean {
  return plan.planned_7d > 0 && plan.planned_14d - plan.planned_7d <= 1;
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

function Card({ a, todayISO, tr, href, tests = [], plan = null }: { a: RosterAthlete; todayISO: string; tr: (k: TKey) => string; href: string | null; tests?: TestStatus[]; plan?: RosterPlanAhead | null }) {
  const farol = a.today_reco ? FAROL[a.today_reco] : null;
  // No light today. Not calm — unknown. This used to be the DEFAULT rendering
  // (soft border, no glow), which meant the athlete who stopped reporting was
  // the quietest card on a grid of glowing ones: the sort raised them and the
  // pixels buried them again.
  const silent = !farol;
  const raceIn = a.next_race_date ? daysBetween(todayISO, a.next_race_date) : null;
  const checkinAgo = a.last_checkin ? daysBetween(a.last_checkin, todayISO) : null;
  const stale = checkinAgo === null || checkinAgo > 3;
  const sports = a.sports ?? [];
  const metrics = a.metrics ?? [];

  const cls =
    "flex h-full flex-col gap-1 rounded-[12px] border bg-[var(--surface)] px-3 py-2.5 transition-colors hover:bg-[var(--surface-2)]";
  // The readiness light lives in the border + a faint outer glow, not a fill.
  // Unknown breaks the line instead of changing its hue: a dashed border is
  // legible as "gap" from across the grid, costs nothing on the colour axis
  // (so it can never be mistaken for red), and lifts the card off the neutral
  // --border-soft it used to hide in. The glow follows so a silent card sits at
  // the same elevation as a lit one rather than sinking into the canvas.
  const style: React.CSSProperties = {
    borderColor: farol ?? "var(--text-faint)",
    borderStyle: silent ? "dashed" : undefined,
    boxShadow: farol ? `0 0 16px -9px ${farol}` : "0 0 16px -10px var(--text-muted)",
  };

  const body = (
    <>
      {/* The name owns a whole line.
          It used to share the header row with the test badge and four modality
          icons, and it was the ONLY flexible element there — everything else was
          shrink-0, so the name lost every squeeze. Measured at 1280px (5 columns,
          218px cards): six of nine names truncated, "Gonçalo Vasconcelos" getting
          58px of the 146px it needs. Telling two athletes apart is the one thing
          a roster card exists to do, so it cannot be the first thing sacrificed —
          the icons drop to their own strip below and the name gets the full
          194px, which fits every name in the cohort with room to spare.

          It wraps rather than truncates. At 1280px nothing wraps — every name
          fits on one line — so this costs no height where the grid is densest;
          it only engages in the two-column phone layout, where the box narrows
          to 140px and the longest name overruns it by 5px. Losing the last
          syllable of a name to save one line of height is a bad trade at any
          width, and two lines still beat an ellipsis for telling two athletes
          apart. Three lines would be a 40-character name, so it clamps there. */}
      <p className="line-clamp-2 break-words text-[14px] font-bold leading-tight text-[var(--text)]">{a.athlete ?? a.name}</p>

      <div className="flex items-center justify-between gap-2">
        <span className="flex shrink-0 items-center gap-[3px]">
          {MODS.map((m) => {
            const on = sports.includes(m);
            return (
              <Icon
                key={m}
                name={m}
                // Lit = the discipline's own colour (same as the calendar); dim = faint.
                style={{ color: on ? `var(--${m})` : "var(--text-faint)", opacity: on ? 1 : 0.32 }}
              />
            );
          })}
        </span>
        {/* Threshold testing. A stale threshold makes an athlete who improved
            look like they are training easier, and a coach with sixty athletes
            cannot hold sixty test dates in their head. */}
        {tests.length > 0 && (
          <span
            className="shrink-0 rounded-full px-1.5 text-[9px] font-bold uppercase leading-[15px]"
            style={{
              color: tests[0].state === "never" ? "var(--bad)" : "var(--warn)",
              background: `color-mix(in oklab, ${tests[0].state === "never" ? "var(--bad)" : "var(--warn)"} 15%, transparent)`,
            }}
            title={tests
              .map((t) => `${t.discipline}: ${t.state === "never" ? tr("coach.testNever") : tr("coach.testWeeks").replace("{n}", String(t.weeksSince))}`)
              .join(" · ")}
          >
            {tr("coach.test")} {tests.length > 1 ? tests.length : ""}
          </span>
        )}
      </div>

      {/* How far the plan reaches. Loud when it has run out, quiet when it is
          about to — the coach needs to see the empty week from across the grid,
          and the fortnight warning only when they're already reading the card. */}
      {plan && plan.planned_7d === 0 && (
        <p
          className="rounded-[6px] px-1.5 py-[3px] text-[10.5px] font-bold uppercase tracking-wide"
          style={{ color: "var(--bad)", background: "color-mix(in oklab, var(--bad) 14%, transparent)" }}
        >
          {tr("coach.noPlan")}
        </p>
      )}
      {/* Silence, named. The dashed border says a card is a gap; this says how
          long. Deliberately HOLLOW — a dashed outline and grey text on no
          background — against the empty-calendar chip's filled coral: the two
          can land on the same card, and the ranking between them has to survive
          that. An athlete receiving no plan is a service failure the coach can
          fix this minute; an athlete who went quiet is a question. Filled beats
          outlined at every distance, so the order reads correctly without either
          one having to shout. */}
      {silent && (
        <p
          className="flex items-center gap-1 rounded-[6px] border border-dashed px-1.5 py-[2px] text-[10.5px] font-bold uppercase tracking-wide"
          style={{ color: "var(--text-muted)", borderColor: "var(--text-faint)" }}
        >
          {/* An unlit light: the ring with nothing in it. Absence gets a mark of
              its own rather than borrowing one of the three colours. */}
          <span
            className="shrink-0 rounded-full"
            style={{ width: 7, height: 7, border: "1px solid var(--text-muted)" }}
            aria-hidden
          />
          <span className="truncate">
            {checkinAgo === null
              ? tr("coach.noCheckin")
              : checkinAgo === 0
                ? tr("coach.noReading")
                : tr("coach.checkinAgo").replace("{n}", String(checkinAgo))}
          </span>
        </p>
      )}
      {plan && planRunningOut(plan) && (
        <p className="text-[10.5px] font-medium" style={{ color: "var(--warn)" }}>
          {tr("coach.planEnding")}
        </p>
      )}

      <div className="flex items-baseline gap-1.5 text-[11px] leading-tight text-[var(--text-faint)]">
        <span className="min-w-0 truncate">{a.next_race_name ?? tr("coach.noRace")}</span>
        {raceIn !== null && raceIn >= 0 && (
          <span className="shrink-0 font-semibold text-[var(--text-muted)]">
            · {raceIn === 0 ? tr("coach.today") : tr("coach.inDays").replace("{n}", String(raceIn))}
          </span>
        )}
      </div>

      {/* mt-auto: grid rows stretch every card to the tallest in the row, so a
          card carrying a chip used to leave its neighbours with dangling empty
          space under the last line. Pinning this band to the bottom turns that
          slack into one horizontal rule of check-in dates across the row — the
          same pixels, now scannable. */}
      <div className="mt-auto flex items-center justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {/* When the light is unknown the check-in fact has already been
              promoted into the chip above; repeating it here would be the same
              sentence twice on one card. */}
          {!silent && (
            <span className="shrink-0 text-[10.5px] font-medium" style={{ color: stale ? "var(--warn)" : "var(--text-faint)" }}>
              {checkinAgo === null
                ? tr("coach.noCheckin")
                : checkinAgo === 0
                  ? tr("coach.checkinToday")
                  : tr("coach.checkinAgo").replace("{n}", String(checkinAgo))}
            </span>
          )}
          {/* A cross rather than the word: in a 200-card grid the label ate the
              width that the athlete's name needs, and severity was invisible —
              a niggle and a tear looked identical. Same scale the athlete sees
              on their own dashboard, so a colour means one thing product-wide. */}
          {a.recent_injuries > 0 && (
            <span
              className="grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full"
              style={{
                color: sevColor(a.injury_severity ?? 1),
                border: `1px solid ${sevColor(a.injury_severity ?? 1)}`,
              }}
              title={`${tr("coach.injury")}${a.injury_severity ? ` · ${a.injury_severity}/5` : ""}`}
              aria-label={`${tr("coach.injury")} ${a.injury_severity ?? ""}`}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M10 2h4v8h8v4h-8v8h-4v-8H2v-4h8z" />
              </svg>
            </span>
          )}
        </div>
        {/* metric capabilities — lit for what the athlete measures */}
        <span className="flex shrink-0 items-center gap-[3px]">
          {METRICS.map(({ key, icon }) => {
            const on = metrics.includes(key);
            return (
              <Icon
                key={key}
                name={icon}
                size={12}
                style={{ color: on ? "var(--text-muted)" : "var(--text-faint)", opacity: on ? 0.9 : 0.22 }}
              />
            );
          })}
        </span>
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
  testsFor,
  planFor,
}: {
  roster: RosterAthlete[];
  locale: Locale;
  todayISO: string;
  /** Where a card links; return null for a non-clickable card. */
  hrefFor: (a: RosterAthlete) => string | null;
  /** Disciplines whose threshold is overdue or never measured, per athlete.
   * Optional so the board still renders before add-test-due.sql has run. */
  testsFor?: (tenantId: string) => TestStatus[];
  /** How far each athlete's plan reaches. Optional, so the board still renders
   * before add-planned-ahead.sql has run. */
  planFor?: (tenantId: string) => RosterPlanAhead | null;
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
        (m, n) =>
          attentionRank(m, todayISO, planFor?.(m.tenant_id)) -
            attentionRank(n, todayISO, planFor?.(n.tenant_id)) || m.name.localeCompare(n.name),
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
              <Card key={a.tenant_id} a={a} todayISO={todayISO} tr={tr} href={hrefFor(a)} tests={testsFor?.(a.tenant_id) ?? []} plan={planFor?.(a.tenant_id) ?? null} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
