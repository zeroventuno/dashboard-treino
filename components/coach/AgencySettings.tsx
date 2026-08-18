"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { translator, type Locale } from "@/lib/i18n";
import { CURRENCIES } from "@/lib/currencies";
import { timezoneNames, todayInZone } from "@/lib/agency-clock";

/**
 * What the agency IS — what it bills in, and where it works.
 *
 * Both were decisions frozen at provisioning: currency defaulted to BRL and
 * could only be changed with SQL, and the time zone did not exist at all, so
 * every screen used the server's day (UTC on Vercel). Neither is cosmetic —
 * currency is the unit on every money figure, and the day drives the readiness
 * light, the to-do list and the "no check-in in N days" counters.
 *
 * Both are PICKED, never typed. A typed currency code throws inside Intl and
 * blanks the screen; a typed zone name resolves to nothing and moves every date
 * by a day without ever announcing itself. The server refuses both anyway — the
 * picker is so the refusal never has to happen.
 *
 * Saves are optimistic and derive from local state, same as TeamAdmin: the
 * server only gets to veto, and a rejection puts the previous value back.
 */
export function AgencySettings({
  currency: initialCurrency,
  timezone: initialTimezone,
  locale,
}: {
  currency: string;
  timezone: string;
  locale: Locale;
}) {
  const tr = translator(locale);
  const router = useRouter();
  const [currency, setCurrency] = useState(initialCurrency);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const zones = useMemo(() => timezoneNames(), []);

  // The preview reads the clock, so it can only be drawn AFTER hydration: the
  // server and the browser can be on opposite sides of midnight, which is the
  // entire point of this screen and would otherwise be a hydration mismatch.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  async function save(patch: { currency?: string; timezone?: string }, revert: () => void) {
    setError(null);
    setSaved(false);
    const res = await fetch("/api/coach/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "agency", ...patch }),
    }).catch(() => null);
    if (!res || !res.ok) {
      revert();
      const body = res ? ((await res.json().catch(() => ({}))) as { code?: string }) : {};
      setError(body.code ?? "error");
      return;
    }
    setSaved(true);
    // Every other screen reads these off the session, so the panel has to be
    // re-rendered for the change to reach the money figures and the dates.
    router.refresh();
  }

  const field =
    "w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition-colors focus:border-[var(--lime)]";

  const sample = (() => {
    try {
      return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(250);
    } catch {
      return currency;
    }
  })();

  return (
    <section className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] p-5">
      <h2 className="text-[13px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{tr("admin.agency")}</h2>
      <p className="mt-0.5 text-[12px] text-[var(--text-faint)]">{tr("admin.agencyHint")}</p>

      <div className="mt-3 flex flex-wrap gap-3">
        <label className="flex min-w-[150px] flex-col gap-1 text-[11.5px] text-[var(--text-faint)]">
          {tr("admin.currency")}
          <select
            className={field}
            value={currency}
            onChange={(e) => {
              const previous = currency;
              const next = e.target.value;
              setCurrency(next);
              void save({ currency: next }, () => setCurrency(previous));
            }}
          >
            {/* A value stored before this list existed still has to be
                selectable, or the picker would silently show the wrong one. */}
            {(CURRENCIES as readonly string[]).includes(currency) ? null : (
              <option value={currency}>{currency}</option>
            )}
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span className="tnum text-[11px] text-[var(--text-muted)]">{sample}</span>
        </label>

        <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-[11.5px] text-[var(--text-faint)]">
          {tr("admin.timezone")}
          <select
            className={field}
            value={timezone}
            onChange={(e) => {
              const previous = timezone;
              const next = e.target.value;
              setTimezone(next);
              void save({ timezone: next }, () => setTimezone(previous));
            }}
          >
            {zones.includes(timezone) ? null : <option value={timezone}>{timezone}</option>}
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          {/* The whole point, made visible: this is the date the panel will
              call "today" — the one the readiness light and the check-in
              counters are measured against. */}
          <span className="tnum text-[11px] text-[var(--text-muted)]">
            {now ? `${tr("admin.todayIs")} ${todayInZone(timezone, now)}` : " "}
          </span>
        </label>
      </div>

      <p className="mt-2 text-[11.5px] text-[var(--text-faint)]">{tr("admin.timezoneHint")}</p>

      {error && (
        <p className="mt-2.5 text-[12px] text-[var(--warn)]">
          {error === "bad_timezone"
            ? tr("admin.badTimezone")
            : error === "bad_currency"
              ? tr("admin.badCurrency")
              : tr("admin.saveError")}
        </p>
      )}
      {saved && !error && <p className="mt-2.5 text-[12px] text-[var(--good)]">{tr("admin.saved")}</p>}
    </section>
  );
}
