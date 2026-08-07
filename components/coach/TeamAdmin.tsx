"use client";

import { useState } from "react";
import { translator, type Locale } from "@/lib/i18n";
import type { StaffMember } from "@/lib/product-db";

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
 * Owner-only team administration: who owns the agency, and which modalities
 * each coach programs. Athletes moved to their own page — assignment belongs
 * next to the athlete list, not buried under the team roster.
 *
 * Every toggle is OPTIMISTIC and derives the next value from local state, never
 * from the server prop. Waiting for the round trip made a chip blink off and
 * back on, and — worse — two quick clicks both computed their result from the
 * same stale prop, so the second silently undid the first. Local state is the
 * truth here; the server only gets to veto it, and a rejection reverts.
 */
export function TeamAdmin({ team, locale }: { team: StaffMember[]; locale: Locale }) {
  const tr = translator(locale);
  const [error, setError] = useState<string | null>(null);

  const [sports, setSports] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(team.map((m) => [m.id, m.sports])),
  );
  const [owners, setOwners] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(team.map((m) => [m.id, m.is_owner])),
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

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <p className="rounded-[12px] border border-[var(--warn)]/50 bg-[var(--surface-2)] px-4 py-2.5 text-[12.5px] text-[var(--warn)]">
          {error === "last_owner" ? tr("admin.lastOwner") : tr("admin.saveError")}
        </p>
      )}

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
                  {m.athlete_count} {m.athlete_count === 1 ? tr("agency.athlete") : tr("agency.athletes")}
                </p>
              </div>

              {/* Modalities are a COACH's business — a nutritionist doesn't
                  program swim sets and a physio doesn't program bike intervals,
                  so offering them the choice was meaningless. */}
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
          ))}
        </ul>
      </section>
    </div>
  );
}
