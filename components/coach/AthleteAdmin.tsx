"use client";

import { useState } from "react";
import Link from "next/link";
import { translator, type Locale } from "@/lib/i18n";
import type { StaffMember, AgencyAthlete } from "@/lib/product-db";

async function save(payload: Record<string, unknown>): Promise<string | null> {
  const res = await fetch("/api/coach/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.ok ? null : ((await res.json().catch(() => ({}))).code ?? "error");
}

/** Initials stand in for a photo. A coach scanning 200 rows needs a shape to
 * anchor on, and initials give that today without a storage bucket, an upload
 * flow and a moderation story behind them. */
function initials(name: string | null, email: string) {
  const source = (name ?? email.split("@")[0]).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

export function AthleteAdmin({
  athletes,
  team,
  currency,
  locale,
}: {
  athletes: AgencyAthlete[];
  team: StaffMember[];
  currency: string;
  locale: Locale;
}) {
  const tr = translator(locale);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  // Optimistic, for the same reason as the team screen: deriving the next value
  // from a server prop loses whichever of two quick clicks lands second.
  const [assign, setAssign] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(athletes.map((a) => [a.tenant_id, a.staff_ids])),
  );
  const [fields, setFields] = useState<
    Record<string, { name: string; nickname: string; phone: string; value: string; extras: string }>
  >(
    () =>
      Object.fromEntries(
        athletes.map((a) => [
          a.tenant_id,
          {
            name: a.name ?? "",
            nickname: a.nickname ?? "",
            phone: a.phone ?? "",
            // String(), not `?? ""`. `monthly_value` is typed `string | null`
            // and ISN'T one: lib/product-db installs a NUMERIC type parser
            // (types.setTypeParser(1700, …)) that hands back a number, so the
            // annotation is a lie tsc has no way to catch. The moment an
            // athlete had a fee, `.trim()` below threw and took the whole page
            // down. Coerce at the boundary rather than trusting the type.
            value: a.monthly_value == null ? "" : String(a.monthly_value),
            extras: a.monthly_value_extras == null ? "" : String(a.monthly_value_extras),
          },
        ]),
      ),
  );

  async function toggleAssign(tenantId: string, staffId: string) {
    const current = assign[tenantId] ?? [];
    const next = current.includes(staffId) ? current.filter((s) => s !== staffId) : [...current, staffId];
    setAssign((p) => ({ ...p, [tenantId]: next }));
    setError(null);
    const err = await save({ kind: "athlete", id: tenantId, staffIds: next });
    if (err) { setAssign((p) => ({ ...p, [tenantId]: current })); setError(err); }
  }

  async function saveField(tenantId: string, patch: Record<string, unknown>) {
    setError(null);
    setError(await save({ kind: "athlete", id: tenantId, ...patch }));
  }

  const money = new Intl.NumberFormat(locale, { style: "currency", currency: currency || "BRL" });
  const total = Object.values(fields).reduce((s, f) => s + (Number(f.value) || 0), 0);
  const unpriced = Object.values(fields).filter((f) => f.value.trim() === "").length;

  return (
    <section className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] p-5">
      {error && (
        <p className="mb-3 rounded-[10px] border border-[var(--warn)]/50 bg-[var(--surface-2)] px-3 py-2 text-[12.5px] text-[var(--warn)]">
          {tr("admin.saveError")}
        </p>
      )}

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
          {tr("admin.athletes")} <span className="tnum text-[var(--text-faint)]">{athletes.length}</span>
        </h2>
        <p className="tnum text-[12.5px] text-[var(--text-muted)]">
          {money.format(total)} <span className="text-[var(--text-faint)]">/{tr("admin.month")}</span>
          {unpriced > 0 && (
            <span className="ml-1.5 text-[11.5px] text-[var(--warn)]">({unpriced} {tr("admin.unpriced")})</span>
          )}
        </p>
      </div>

      {athletes.length === 0 ? (
        <p className="mt-3 text-[13px] text-[var(--text-faint)]">{tr("athletes.none")}</p>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-[var(--border-soft)]">
          {athletes.map((a) => {
            const f = fields[a.tenant_id];
            const expanded = open === a.tenant_id;
            return (
              <li key={a.tenant_id} className="py-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12px] font-bold"
                    style={{ background: "var(--surface-2)", color: "var(--lime)" }}
                    aria-hidden
                  >
                    {initials(a.name, a.email)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold text-[var(--text)]">
                      {a.name ?? a.email}
                      {a.nickname && (
                        <span className="ml-1.5 text-[11.5px] font-normal text-[var(--text-faint)]">
                          &ldquo;{a.nickname}&rdquo;
                        </span>
                      )}
                    </p>
                    <p className="truncate text-[11.5px] text-[var(--text-faint)]">
                      {[a.email, a.phone].filter(Boolean).join(" · ")}
                    </p>
                  </div>

                  {/* Who looks after this athlete. */}
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
                      value={f.value}
                      onChange={(e) =>
                        setFields((p) => ({ ...p, [a.tenant_id]: { ...p[a.tenant_id], value: e.target.value } }))
                      }
                      onBlur={(e) => {
                        if (e.target.value !== (a.monthly_value ?? "")) {
                          saveField(a.tenant_id, { monthlyValue: e.target.value });
                        }
                      }}
                      inputMode="decimal"
                      placeholder="—"
                      aria-label={tr("admin.monthlyValue")}
                      className="tnum w-[86px] rounded-[8px] border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1 text-right text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--lime)]"
                    />
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Link
                      href={`/coach/a/${a.tenant_id}`}
                      className="rounded-[8px] border border-[var(--border)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--text)] hover:text-[var(--text)]"
                    >
                      {tr("athletes.openPanel")}
                    </Link>
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : a.tenant_id)}
                      className="rounded-[8px] border border-[var(--border)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--text-faint)] transition-colors hover:text-[var(--text-muted)]"
                    >
                      {expanded ? tr("athletes.close") : tr("athletes.edit")}
                    </button>
                  </div>
                </div>

                {/* Details stay folded away: the row is for scanning, this is
                    for the once-in-a-while correction. */}
                {expanded && (
                  <div className="mt-3 grid grid-cols-1 gap-2 rounded-[10px] border border-[var(--border-soft)] bg-[var(--surface-2)] p-3 sm:grid-cols-3">
                    {(["name", "nickname", "phone"] as const).map((k) => (
                      <label key={k} className="block">
                        <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
                          {tr(`athletes.${k}` as Parameters<typeof tr>[0])}
                        </span>
                        <input
                          value={f[k]}
                          onChange={(e) =>
                            setFields((p) => ({ ...p, [a.tenant_id]: { ...p[a.tenant_id], [k]: e.target.value } }))
                          }
                          onBlur={(e) => {
                            const original = (k === "name" ? a.name : k === "nickname" ? a.nickname : a.phone) ?? "";
                            if (e.target.value !== original) saveField(a.tenant_id, { [k]: e.target.value });
                          }}
                          className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--bg-soft)] px-2.5 py-1.5 text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--lime)]"
                        />
                      </label>
                    ))}
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
                        {tr("admin.extrasValue")}
                      </span>
                      <input
                        value={f.extras}
                        onChange={(e) =>
                          setFields((p) => ({ ...p, [a.tenant_id]: { ...p[a.tenant_id], extras: e.target.value } }))
                        }
                        onBlur={(e) => {
                          if (e.target.value !== String(a.monthly_value_extras ?? "")) {
                            saveField(a.tenant_id, { extrasValue: e.target.value });
                          }
                        }}
                        inputMode="decimal"
                        placeholder="—"
                        className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--bg-soft)] px-2.5 py-1.5 text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--lime)]"
                      />
                    </label>
                    <p className="text-[11.5px] text-[var(--text-faint)] sm:col-span-3">
                      {tr("athletes.emailFixed")} <span className="text-[var(--text-muted)]">{a.email}</span>
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
