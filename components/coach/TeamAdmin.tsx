"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { translator, type Locale } from "@/lib/i18n";
import type { StaffMember, AgencyAthlete } from "@/lib/product-db";

const SPORTS = ["swim", "bike", "run", "strength"] as const;
const SPORT_LABEL: Record<string, string> = { swim: "Natação", bike: "Bike", run: "Corrida", strength: "Força" };

async function save(payload: Record<string, unknown>) {
  const res = await fetch("/api/coach/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok ? null : ((await res.json().catch(() => ({}))).code ?? "error");
}

/**
 * Owner-only administration. Two things the panel had no way to express:
 * who owns the agency (and therefore sees every book), and who looks after
 * whom — which until now could only be done with SQL by hand.
 */
export function TeamAdmin({
  team,
  athletes,
  currency,
  locale,
}: {
  team: StaffMember[];
  athletes: AgencyAthlete[];
  currency: string;
  locale: Locale;
}) {
  const tr = translator(locale);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function patch(payload: Record<string, unknown>, id: string) {
    setBusy(id);
    setError(await save(payload));
    setBusy(null);
    router.refresh();
  }

  const money = new Intl.NumberFormat(locale, { style: "currency", currency: currency || "BRL" });
  const total = athletes.reduce((s, a) => s + Number(a.monthly_value ?? 0), 0);
  const priced = athletes.filter((a) => a.monthly_value != null).length;

  return (
    <div className="flex flex-col gap-5">
      {error === "last_owner" && (
        <p className="rounded-[12px] border border-[var(--warn)]/50 bg-[var(--surface-2)] px-4 py-2.5 text-[12.5px] text-[var(--warn)]">
          {tr("admin.lastOwner")}
        </p>
      )}

      {/* ── Team ─────────────────────────────────────────────────────────── */}
      <section className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <h2 className="text-[13px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
          {tr("admin.team")} <span className="tnum text-[var(--text-faint)]">{team.length}</span>
        </h2>
        <p className="mt-0.5 text-[12px] text-[var(--text-faint)]">{tr("admin.teamHint")}</p>

        <ul className="mt-3 flex flex-col divide-y divide-[var(--border-soft)]">
          {team.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-[var(--text)]">
                  {m.name ?? m.email ?? "—"}{" "}
                  <span className="text-[11.5px] font-normal text-[var(--text-faint)]">
                    · {tr(`coach.role.${m.role}` as Parameters<typeof tr>[0])}
                  </span>
                </p>
                <p className="tnum mt-0.5 text-[11.5px] text-[var(--text-faint)]">
                  {m.athlete_count} {tr("agency.athletes")}
                </p>
              </div>

              {/* Specialties: empty means no restriction, so an agency that
                  never fills this in isn't punished for it. */}
              <div className="flex flex-wrap gap-1">
                {SPORTS.map((s) => {
                  const on = m.sports.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      disabled={busy === m.id}
                      onClick={() =>
                        patch(
                          { kind: "staff", id: m.id, sports: on ? m.sports.filter((x) => x !== s) : [...m.sports, s] },
                          m.id,
                        )
                      }
                      className="rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40"
                      style={{
                        borderColor: on ? `var(--${s})` : "var(--border)",
                        color: on ? `var(--${s})` : "var(--text-faint)",
                        background: on ? `color-mix(in oklab, var(--${s}) 14%, transparent)` : "transparent",
                      }}
                    >
                      {SPORT_LABEL[s]}
                    </button>
                  );
                })}
              </div>

              <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
                <input
                  type="checkbox"
                  checked={m.is_owner}
                  disabled={busy === m.id}
                  onChange={(e) => patch({ kind: "staff", id: m.id, isOwner: e.target.checked }, m.id)}
                  className="h-3.5 w-3.5 accent-[var(--lime)]"
                />
                {tr("admin.owner")}
              </label>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Athletes ─────────────────────────────────────────────────────── */}
      <section className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
            {tr("admin.athletes")} <span className="tnum text-[var(--text-faint)]">{athletes.length}</span>
          </h2>
          <p className="tnum text-[12.5px] text-[var(--text-muted)]">
            {money.format(total)} <span className="text-[var(--text-faint)]">/{tr("admin.month")}</span>
            {priced < athletes.length && (
              <span className="ml-1.5 text-[11.5px] text-[var(--warn)]">
                ({athletes.length - priced} {tr("admin.unpriced")})
              </span>
            )}
          </p>
        </div>
        <p className="mt-0.5 text-[12px] text-[var(--text-faint)]">{tr("admin.athletesHint")}</p>

        {athletes.length === 0 ? (
          <p className="mt-3 text-[13px] text-[var(--text-faint)]">{tr("agency.noAthletes")}</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-[var(--border-soft)]">
            {athletes.map((a) => (
              <AthleteRow
                key={a.tenant_id}
                a={a}
                team={team}
                currency={currency}
                busy={busy === a.tenant_id}
                onSave={(payload) => patch({ kind: "athlete", id: a.tenant_id, ...payload }, a.tenant_id)}
                tr={tr}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AthleteRow({
  a, team, currency, busy, onSave, tr,
}: {
  a: AgencyAthlete;
  team: StaffMember[];
  currency: string;
  busy: boolean;
  onSave: (payload: Record<string, unknown>) => void;
  tr: ReturnType<typeof translator>;
}) {
  const [value, setValue] = useState(a.monthly_value ?? "");

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold text-[var(--text)]">{a.name ?? a.email}</p>
        <p className="truncate text-[11.5px] text-[var(--text-faint)]">{a.email}</p>
      </div>

      {/* Who looks after this athlete — the assignment that until now needed SQL. */}
      <div className="flex flex-wrap gap-1">
        {team.map((m) => {
          const on = a.staff_ids.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              disabled={busy}
              onClick={() =>
                onSave({ staffIds: on ? a.staff_ids.filter((x) => x !== m.id) : [...a.staff_ids, m.id] })
              }
              title={m.role}
              className="rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40"
              style={{
                borderColor: on ? "var(--lime)" : "var(--border)",
                color: on ? "var(--lime)" : "var(--text-faint)",
                background: on ? "color-mix(in oklab, var(--lime) 14%, transparent)" : "transparent",
              }}
            >
              {(m.name ?? m.email ?? "?").split(" ")[0]}
            </button>
          );
        })}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <span className="text-[11.5px] text-[var(--text-faint)]">{currency}</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => { if (String(value) !== String(a.monthly_value ?? "")) onSave({ monthlyValue: value }); }}
          inputMode="decimal"
          placeholder="—"
          disabled={busy}
          aria-label={tr("admin.monthlyValue")}
          className="tnum w-[92px] rounded-[8px] border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1 text-right text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--lime)] disabled:opacity-40"
        />
      </div>
    </li>
  );
}
