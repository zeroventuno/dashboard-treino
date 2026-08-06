import Link from "next/link";
import { needsAttention, totals, byStaff, type AttentionRow } from "@/lib/retention";
import { translator, type Locale } from "@/lib/i18n";

/** "5x → 1x" per week, the reading an owner acts on. Halves render as 2.5. */
const perWeek = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export function AgencyBoard({
  rows,
  todayISO,
  locale,
}: {
  rows: AttentionRow[];
  todayISO: string;
  locale: Locale;
}) {
  const tr = translator(locale);
  const t = totals(rows, todayISO);
  const list = needsAttention(rows, todayISO);
  const loads = byStaff(rows, todayISO);

  const Stat = ({ label, value, color }: { label: string; value: number; color?: string }) => (
    <div className="rounded-[12px] border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
      <p className="dsp tnum text-[24px] font-extrabold leading-none" style={{ color: color ?? "var(--text)" }}>
        {value}
      </p>
      <p className="mt-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-faint)]">{label}</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label={tr("agency.total")} value={t.total} />
        <Stat label={tr("agency.active")} value={t.active} color="var(--good)" />
        <Stat label={tr("agency.atRisk")} value={t.atRisk} color="var(--warn)" />
        <Stat label={tr("agency.inactive")} value={t.inactive} color="var(--bad)" />
        <Stat label={tr("agency.new")} value={t.newAthletes} color="var(--lime)" />
      </div>

      {/* The queue — the reason this screen exists. */}
      <section>
        <h2 className="mb-1 px-1 text-[14px] font-bold text-[var(--text)]">{tr("agency.attention")}</h2>
        <p className="mb-2.5 px-1 text-[12.5px] text-[var(--text-faint)]">{tr("agency.attentionHint")}</p>

        {list.length === 0 ? (
          <p className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] px-5 py-8 text-center text-[13.5px] text-[var(--text-faint)]">
            {rows.length === 0 ? tr("agency.noAthletes") : tr("agency.allGood")}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {list.map((a) => {
              const risk = a.state === "at_risk";
              const color = risk ? "var(--warn)" : "var(--bad)";
              return (
                <Link
                  key={a.tenant_id}
                  href={`/coach/a/${a.tenant_id}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[12px] border bg-[var(--surface)] px-4 py-3 transition-colors hover:border-[var(--text-faint)]"
                  style={{ borderColor: "var(--border-soft)", borderLeft: `3px solid ${color}` }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold text-[var(--text)]">{a.name}</p>
                    <p className="mt-0.5 text-[11.5px] text-[var(--text-faint)]">
                      {a.staff.length ? a.staff.join(", ") : tr("agency.noStaff")}
                    </p>
                  </div>

                  {/* The drop, stated plainly — this is the sentence that makes
                      an owner pick up the phone. */}
                  <div className="text-right">
                    <p className="tnum text-[13px] font-semibold" style={{ color }}>
                      {a.done_prev > 0
                        ? `${perWeek(a.weeklyBefore)}x → ${perWeek(a.weeklyNow)}x ${tr("agency.perWeek")}`
                        : tr("agency.neverTrained")}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-[var(--text-faint)]">
                      {a.daysSilent == null
                        ? tr("agency.noSignal")
                        : `${tr("agency.silentFor")} ${a.daysSilent}${tr("agency.days")}`}
                    </p>
                  </div>

                  <span
                    className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase"
                    style={{ borderColor: color, color }}
                  >
                    {risk ? tr("agency.atRisk") : tr("agency.inactive")}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Load per professional: 40 athletes with falling engagement is a
          different problem from 8. */}
      {loads.length > 0 && (
        <section>
          <h2 className="mb-2 px-1 text-[14px] font-bold text-[var(--text)]">{tr("agency.byStaff")}</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {loads.map((s) => (
              <div key={s.name} className="rounded-[12px] border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3">
                <p className="text-[13px] font-semibold text-[var(--text)]">
                  {s.name === "—" ? tr("agency.noStaff") : s.name}
                </p>
                <p className="mt-1 flex items-baseline gap-2">
                  <span className="dsp tnum text-[20px] font-extrabold text-[var(--text)]">{s.athletes}</span>
                  <span className="text-[11.5px] text-[var(--text-faint)]">{tr("agency.athletes")}</span>
                </p>
                <div className="mt-2 h-[4px] w-full overflow-hidden rounded-full bg-[#1a1d23]">
                  <div
                    className="h-full rounded-full bg-[var(--good)]"
                    style={{ width: `${s.athletes ? (s.active / s.athletes) * 100 : 0}%` }}
                  />
                </div>
                <p className="tnum mt-1.5 text-[11.5px] text-[var(--text-muted)]">
                  {s.active} {tr("agency.activeShort")} · <span style={{ color: s.atRisk ? "var(--warn)" : undefined }}>{s.atRisk} {tr("agency.atRiskShort")}</span>
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
