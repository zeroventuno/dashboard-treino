"use client";

import { useState } from "react";
import { SectionCard } from "../SectionCard";
import { Icon, type IconName } from "@/components/coach/icons";
import { translator, type Locale, type TKey } from "@/lib/i18n";
import { EQUIPMENT, readEquipment, type Equipment } from "@/lib/prescription";
import {
  WEEKDAYS, HOUR_CHOICES, weeklyHours, longDays, sportsFor,
  normalizeHours, normalizeSports,
  type Availability, type Weekday, type WeekHours, type WeekSports,
} from "@/lib/availability";

const SPORTS: IconName[] = ["swim", "bike", "run", "strength"];

/**
 * The athlete's own week: how much time each day holds, which days can take a
 * long session, and which sports they'd rather do when.
 *
 * Editable by the athlete because they are the only one who knows — a coach can
 * infer training days from history, but never "Tuesday I have class" or "the
 * swim squad meets Thursday". Written once, read forever: by the athlete's AI in
 * B2C, by their coach in B2B, through the same profile field.
 *
 * The sports row is a PREFERENCE, never a restriction. All off and all on say
 * the same thing — "anything goes" — because a blank row is far more likely to
 * mean the athlete never filled it in than that they refuse to train.
 */
export function AvailabilityBlock({
  preferences,
  locale,
  editable,
}: {
  preferences: Availability;
  locale: Locale;
  editable: boolean;
}) {
  const tr = translator(locale);
  const [hours, setHours] = useState<WeekHours>(preferences.hours ?? {});
  const [longs, setLongs] = useState<Weekday[]>(() => longDays(preferences));
  const [sports, setSports] = useState<WeekSports>(() =>
    Object.fromEntries(WEEKDAYS.map((d) => [d, sportsFor(preferences, d)])) as WeekSports,
  );
  const [kit, setKit] = useState<Equipment[]>(() => readEquipment(preferences.equipment));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function persist(next: {
    hours?: WeekHours;
    longs?: Weekday[];
    sports?: WeekSports;
    kit?: Equipment[];
  }) {
    if (!editable) return;
    setState("saving");
    try {
      const res = await fetch("/api/app/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hours: normalizeHours(next.hours ?? hours),
          long_days: next.longs ?? longs,
          sports: normalizeSports(next.sports ?? sports),
          equipment: next.kit ?? kit,
        }),
      });
      setState(res.ok ? "saved" : "error");
      if (res.ok) setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
    }
  }

  function setDayHours(day: Weekday, value: number) {
    const nextHours = { ...hours, [day]: value };
    setHours(nextHours);
    // A day with no time can't hold a long session.
    const nextLongs = value === 0 ? longs.filter((d) => d !== day) : longs;
    if (nextLongs !== longs) setLongs(nextLongs);
    void persist({ hours: nextHours, longs: nextLongs });
  }

  function toggleLong(day: Weekday) {
    const next = longs.includes(day) ? longs.filter((d) => d !== day) : [...longs, day];
    setLongs(next);
    void persist({ longs: next });
  }

  function toggleSport(day: Weekday, sport: string) {
    const current = sports[day] ?? [];
    const next = { ...sports, [day]: current.includes(sport) ? current.filter((s) => s !== sport) : [...current, sport] };
    setSports(next);
    void persist({ sports: next });
  }

  const total = weeklyHours({ hours });
  const fmt = (h: number) => (h === 0 ? "—" : h % 1 === 0 ? `${h}h` : `${Math.floor(h)}h${(h % 1) * 60}`);

  return (
    <SectionCard title={tr("availability.title")} subtitle={tr("availability.sub")}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {WEEKDAYS.map((d) => {
          const h = hours[d] ?? 0;
          const on = h > 0;
          const isLong = longs.includes(d);
          const daySports = sports[d] ?? [];
          return (
            <div
              key={d}
              className="flex flex-col gap-1.5 rounded-[12px] border p-2"
              style={{
                borderColor: isLong ? "var(--lime)" : on ? "var(--border)" : "var(--border-soft)",
                background: on ? "var(--surface-2)" : "var(--bg-soft)",
              }}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
                  {tr(`availability.${d}` as Parameters<typeof tr>[0])}
                </span>
                {/* Long day: an explicit toggle. It used to be an underlined
                    word that read as a label, so nobody pressed it. */}
                {editable && on && (
                  <button
                    type="button"
                    onClick={() => toggleLong(d)}
                    title={tr("availability.longHint")}
                    className="rounded-full px-1.5 text-[9px] font-bold uppercase leading-[15px] transition-colors"
                    style={{
                      border: `1px solid ${isLong ? "var(--lime)" : "var(--border)"}`,
                      color: isLong ? "var(--lime)" : "var(--text-faint)",
                      background: isLong ? "color-mix(in oklab, var(--lime) 16%, transparent)" : "transparent",
                    }}
                  >
                    {tr("availability.long")}
                  </button>
                )}
                {!editable && isLong && (
                  <span className="text-[9px] font-bold uppercase text-[var(--lime)]">{tr("availability.long")}</span>
                )}
              </div>

              {/* One tap opens the list, one tap picks — instead of tapping
                  twelve times to walk from 30min to 6h. */}
              {editable ? (
                <select
                  value={h}
                  onChange={(e) => setDayHours(d, Number(e.target.value))}
                  aria-label={tr(`availability.${d}` as Parameters<typeof tr>[0])}
                  className="w-full cursor-pointer rounded-[8px] border bg-transparent px-1.5 py-1.5 text-center text-[15px] font-bold outline-none"
                  style={{
                    borderColor: on ? "var(--lime)" : "var(--border)",
                    color: on ? "var(--lime)" : "var(--text-faint)",
                  }}
                >
                  {HOUR_CHOICES.map((c) => (
                    <option key={c} value={c} style={{ color: "var(--text)", background: "var(--surface)" }}>
                      {fmt(c)}
                    </option>
                  ))}
                </select>
              ) : (
                <p
                  className="rounded-[8px] border py-1.5 text-center text-[15px] font-bold"
                  style={{ borderColor: "var(--border)", color: on ? "var(--lime)" : "var(--text-faint)" }}
                >
                  {fmt(h)}
                </p>
              )}

              {/* Preferred sports. Nothing lit = no preference, which is exactly
                  what an athlete who skipped this row means. */}
              <div className="flex items-center justify-center gap-1">
                {SPORTS.map((s) => {
                  const lit = daySports.includes(s);
                  const btn = (
                    <Icon
                      name={s}
                      size={14}
                      style={{ color: lit ? `var(--${s})` : "var(--text-faint)", opacity: lit ? 1 : 0.3 }}
                    />
                  );
                  return editable ? (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSport(d, s)}
                      title={tr(`discipline.${s}` as Parameters<typeof tr>[0])}
                      aria-label={tr(`discipline.${s}` as Parameters<typeof tr>[0])}
                      className="rounded p-0.5"
                    >
                      {btn}
                    </button>
                  ) : (
                    <span key={s} className="p-0.5">{btn}</span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* What the athlete can measure. It lives here, next to the hours, because
          both answer the same question — what does a realistic week look like
          for THIS person — and because this is the block they already open to
          correct things about themselves.

          It is not decoration: it decides whether a prescribed block reaches
          them as watts, a pace, a heart-rate band or an RPE. Ticking nothing is
          a valid answer and yields RPE, which needs no equipment at all. */}
      <div className="mt-4 border-t border-[var(--border-soft)] pt-3.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
          {tr("availability.kit")}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EQUIPMENT.map((e) => {
            const on = kit.includes(e);
            return (
              <button
                key={e}
                type="button"
                disabled={!editable}
                onClick={() => {
                  // Optimistic, like the sport toggles: deriving from the server
                  // prop meant two fast taps both started from stale state and
                  // the second undid the first.
                  const next = on ? kit.filter((x) => x !== e) : [...kit, e];
                  setKit(next);
                  void persist({ kit: next });
                }}
                className="rounded-full border px-3 py-1 text-[11.5px] font-semibold transition-colors disabled:opacity-60"
                style={{
                  borderColor: on ? "var(--lime)" : "var(--border)",
                  background: on ? "var(--lime)" : "transparent",
                  color: on ? "#0a0b0d" : "var(--text-muted)",
                }}
              >
                {tr(`equipment.${e}` as TKey)}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-faint)]">
          {tr("availability.kitHint")}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="tnum text-[12.5px] text-[var(--text-muted)]">
          <span className="font-bold text-[var(--text)]">{fmt(total)}</span> {tr("availability.perWeek")}
        </p>
        {editable && <p className="text-[11.5px] text-[var(--text-faint)]">{tr("availability.hint")}</p>}
        {state === "saved" && <span className="text-[11.5px] text-[var(--good)]">{tr("availability.saved")}</span>}
        {state === "error" && <span className="text-[11.5px] text-[var(--bad)]">{tr("admin.saveError")}</span>}
      </div>
    </SectionCard>
  );
}
