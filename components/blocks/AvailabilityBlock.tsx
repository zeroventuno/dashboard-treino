"use client";

import { useState } from "react";
import { SectionCard } from "../SectionCard";
import { translator, type Locale } from "@/lib/i18n";
import { WEEKDAYS, weeklyHours, normalizeHours, type Availability, type Weekday, type WeekHours } from "@/lib/availability";

const STEPS = [0, 0.5, 1, 1.5, 2, 3];

/**
 * The athlete's own week: how much time each day actually holds.
 *
 * Editable by the athlete because they are the only one who knows — a coach can
 * infer training days from history, but never "Tuesday I have class". Written
 * once and read forever after: by the athlete's AI in B2C, by their coach in
 * B2B, both through the same profile field.
 *
 * Hours per day rather than a days-off toggle: "Tuesday off" and "Tuesday, 40
 * minutes" produce different weeks, and only the second tells anyone they can
 * put the recovery run there.
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
  const [longDay, setLongDay] = useState<Weekday | null>((preferences.long_day as Weekday) ?? null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function persist(nextHours: WeekHours, nextLong: Weekday | null) {
    if (!editable) return;
    setState("saving");
    try {
      const res = await fetch("/api/app/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours: normalizeHours(nextHours), long_day: nextLong }),
      });
      setState(res.ok ? "saved" : "error");
      if (res.ok) setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
    }
  }

  function cycle(day: Weekday) {
    // Tapping steps through the realistic options instead of asking for a
    // number: on a phone, at 6am, nobody types "1.5".
    const current = hours[day] ?? 0;
    const idx = STEPS.findIndex((s) => s === current);
    const next = STEPS[(idx + 1) % STEPS.length];
    const nextHours = { ...hours, [day]: next };
    setHours(nextHours);
    // A day with no time can't hold the long session.
    const nextLong = next === 0 && longDay === day ? null : longDay;
    if (nextLong !== longDay) setLongDay(nextLong);
    void persist(nextHours, nextLong);
  }

  const total = weeklyHours({ hours });
  const fmt = (h: number) => (h === 0 ? "—" : h % 1 === 0 ? `${h}h` : `${Math.floor(h)}h${(h % 1) * 60}`);

  return (
    <SectionCard title={tr("availability.title")} subtitle={tr("availability.sub")}>
      <div className="grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((d) => {
          const h = hours[d] ?? 0;
          const on = h > 0;
          const isLong = longDay === d;
          return (
            <div key={d} className="flex flex-col items-center gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
                {tr(`availability.${d}` as Parameters<typeof tr>[0])}
              </span>
              <button
                type="button"
                onClick={() => cycle(d)}
                disabled={!editable}
                aria-label={`${tr(`availability.${d}` as Parameters<typeof tr>[0])}: ${fmt(h)}`}
                className="flex h-[52px] w-full flex-col items-center justify-center rounded-[10px] border transition-colors disabled:cursor-default"
                style={{
                  borderColor: on ? "var(--lime)" : "var(--border)",
                  background: on ? "color-mix(in oklab, var(--lime) 12%, transparent)" : "var(--bg-soft)",
                  color: on ? "var(--lime)" : "var(--text-faint)",
                }}
              >
                <span className="tnum text-[13px] font-bold">{fmt(h)}</span>
                {isLong && <span className="text-[8.5px] font-bold uppercase">{tr("availability.long")}</span>}
              </button>
              {/* Marking the long day only makes sense where there is time. */}
              {editable && on && (
                <button
                  type="button"
                  onClick={() => { const v = isLong ? null : d; setLongDay(v); void persist(hours, v); }}
                  className="text-[9px] font-medium underline"
                  style={{ color: isLong ? "var(--lime)" : "var(--text-faint)" }}
                >
                  {tr("availability.setLong")}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="tnum text-[12.5px] text-[var(--text-muted)]">
          <span className="font-bold text-[var(--text)]">{total}h</span> {tr("availability.perWeek")}
        </p>
        {editable && <p className="text-[11.5px] text-[var(--text-faint)]">{tr("availability.hint")}</p>}
        {state === "saved" && <span className="text-[11.5px] text-[var(--good)]">{tr("availability.saved")}</span>}
        {state === "error" && <span className="text-[11.5px] text-[var(--bad)]">{tr("admin.saveError")}</span>}
      </div>
    </SectionCard>
  );
}
