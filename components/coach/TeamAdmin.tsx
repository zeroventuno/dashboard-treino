"use client";

import { useState } from "react";
import { translator, type Locale } from "@/lib/i18n";
import type { StaffMember, AgencyAthlete } from "@/lib/product-db";

const SPORTS = ["swim", "bike", "run", "strength"] as const;
const SPORT_LABEL: Record<string, string> = { swim: "Natação", bike: "Bike", run: "Corrida", strength: "Força" };

async function save(payload: Record<string, unknown>): Promise<string | null> {
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
 *
 * Every toggle is OPTIMISTIC and derives the next value from local state, never
 * from the server prop. Waiting for the round trip made a chip blink off and
 * back on, and — worse — two quick clicks both computed their result from the
 * same stale prop, so the second silently undid the first. Local state is the
 * truth here; the server only gets to veto it, and a rejection reverts.
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
  const [error, setError] = useState<string | null>(null);

  const [sports, setSports] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(team.map((m) => [m.id, m.sports])),
  );
  const [owners, setOwners] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(team.map((m) => [m.id, m.is_owner])),
  );
  const [assign, setAssign] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(athletes.map((a) => [a.tenant_id, a.staff_ids])),
  );
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(athletes.map((a) => [a.tenant_id, a.monthly_value ?? ""])),
  );

  async function toggleSport(id: string, sport: string) {
    const current = sports[id] ?? [];
    const next = current.includes(sport) ? current.filter((s) => s !== sport) : [...current, sport];
    setSports((p) => ({ ...p, [id]: next })); // paint first
    setError(null);
    const err = await save({ kind: "staff", id, sports: next });
    if (err) { setSports((p) => ({ ...p, [id]: current })); setError(err); }
  }

  async function toggleOwner(id: string, isOwner: boolean) {
    const previous = owners[id] ?? false;
    setOwners((p) => ({ ...p, [id]: isOwner }));
    setError(null);
    const err = await save({ kind: "staff", id, isOwner });
    // The server refuses to remove the last owner; put the tick back if so.
    if (err) { setOwners((p) => ({ ...p, [id]: previous })); setError(err); }
  }

  async function toggleAssign(tenantId: string, staffId: string) {
    const current = assign[tenantId] ?? [];
    const next = current.includes(staffId) ? current.filter((s) => s !== staffId) : [...current, staffId];
    setAssign((p) => ({ ...p, [tenantId]: next }));
    setError(null);
    const err = await save({ kind: "athlete", id: tenantId, staffIds: next });
    if (err) { setAssign((p) => ({ ...p, [tenantId]: current })); setError(err); }
  }

  async function saveValue(tenantId: string, raw: string) {
    setError(null);
    const err = await save({ kind: "athlete", id: tenantId, monthlyValue: raw });
    if (err) {
      const original = athletes.find((a) => a.tenant_id === tenantId)?.monthly_value ?? "";
      setValues((p) => ({ ...p, [tenantId]: original }));
      setError(err);
    }
  }

  const money = new Intl.NumberFormat(locale, { style: "currency", currency: currency || "BRL" });
  // Counted from local state so the number moves with the click, instead of
  // waiting for a page refresh that would also undo the optimistic chips.
  const countFor = (staffId: string) => Object.values(assign).filter((ids) => ids.includes(staffId)).length;
  const total = Object.values(values).reduce((s, v) => s + (Number(v) || 0), 0);
  const unpriced = Object.values(values).filter((v) => String(v).trim() === "").length;

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <p className="rounded-[12px] border border-[var(--warn)]/50 bg-[var(--surface-2)] px-4 py-2.5 text-[12.5px] text-[var(--warn)]">
          {error === "last_owner" ? tr("admin.lastOwner") : tr("admin.saveError")}
        </p>
      )}

      {/* ── Team ─────────────────────────────────────────────────────────── */}
      <section className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <h2 className="text-[13px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
          {tr("admin.team")} <span className="tnum text-[var(--text-faint)]">{team.length}</span>
        </h2>
        <p className="mt-0.5 text-[12px] text-[var(--text-faint)]">{tr("admin.teamHint")}</p>

        <ul className="mt-3 flex flex-col divide-y divide-[var(--border-soft)]">
          {team.map((m) => {
            const count = countFor(m.id);
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold text-[var(--text)]">
                    {m.name ?? m.email ?? "—"}{" "}
                    <span className="text-[11.5px] font-normal text-[var(--text-faint)]">
                      · {tr(`coach.role.${m.role}` as Parameters<typeof tr>[0])}
                    </span>
                  </p>
                  <p className="tnum mt-0.5 text-[11.5px] text-[var(--text-faint)]">
                    {count} {count === 1 ? tr("agency.athlete") : tr("agency.athletes")}
                  </p>
                </div>

                {/* Modalities are a COACH's business — a nutritionist doesn't
                    program swim sets and a physio doesn't program bike
                    intervals, so offering them the choice was meaningless. */}
                {m.role === "coach" && (
                  <div className="flex flex-wrap gap-1">
                    {SPORTS.map((s) => {
                      const on = (sports[m.id] ?? []).includes(s);
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => toggleSport(m.id, s)}
                          className="rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors"
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
                )}

                <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
                  <input
                    type="checkbox"
                    checked={owners[m.id] ?? false}
                    onChange={(e) => toggleOwner(m.id, e.target.checked)}
                    className="h-3.5 w-3.5 accent-[var(--lime)]"
                  />
                  {tr("admin.owner")}
                </label>
              </li>
            );
          })}
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
            {unpriced > 0 && (
              <span className="ml-1.5 text-[11.5px] text-[var(--warn)]">
                ({unpriced} {tr("admin.unpriced")})
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
              <li key={a.tenant_id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-[var(--text)]">{a.name ?? a.email}</p>
                  <p className="truncate text-[11.5px] text-[var(--text-faint)]">{a.email}</p>
                </div>

                {/* Who looks after this athlete — the assignment that until now
                    needed SQL by hand. */}
                <div className="flex flex-wrap gap-1">
                  {team.map((m) => {
                    const on = (assign[a.tenant_id] ?? []).includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggleAssign(a.tenant_id, m.id)}
                        title={tr(`coach.role.${m.role}` as Parameters<typeof tr>[0])}
                        className="rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors"
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
                    value={values[a.tenant_id] ?? ""}
                    onChange={(e) => setValues((p) => ({ ...p, [a.tenant_id]: e.target.value }))}
                    onBlur={(e) => {
                      if (e.target.value !== String(a.monthly_value ?? "")) saveValue(a.tenant_id, e.target.value);
                    }}
                    inputMode="decimal"
                    placeholder="—"
                    aria-label={tr("admin.monthlyValue")}
                    className="tnum w-[92px] rounded-[8px] border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1 text-right text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--lime)]"
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
