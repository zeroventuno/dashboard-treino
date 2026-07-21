"use client";

import { useEffect, useState } from "react";
import { RACE_DATE } from "@/lib/types";
import { DEFAULT_LOCALE, translator, type Locale } from "@/lib/i18n";

/** The race being counted down to. Defaults to the personal dashboard's race;
 * the multi-tenant /app passes each athlete's own, which is the whole point —
 * this clock used to be hardcoded and every tenant saw the same date. */
function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 7, 0, 0); // gun ~07:00 local
}

function diff(raceISO: string) {
  let ms = parseISO(raceISO).getTime() - Date.now();
  if (ms < 0) ms = 0;
  const totalDays = Math.floor(ms / 86_400_000);
  return {
    totalDays,
    weeks: Math.floor(totalDays / 7),
    days: totalDays % 7,
    hours: Math.floor((ms % 86_400_000) / 3_600_000),
    mins: Math.floor((ms % 3_600_000) / 60_000),
    secs: Math.floor((ms % 60_000) / 1000),
  };
}

/** Nav pill — same clock as the hero countdown so the two never disagree
 * (the old server-rendered value could lag a day behind via ISR cache). */
export function DaysPill({ raceISO = RACE_DATE, locale = DEFAULT_LOCALE }: { raceISO?: string; locale?: Locale }) {
  const tr = translator(locale);
  const [t, setT] = useState<ReturnType<typeof diff> | null>(null);
  useEffect(() => {
    setT(diff(raceISO));
    const id = setInterval(() => setT(diff(raceISO)), 30_000);
    return () => clearInterval(id);
  }, [raceISO]);
  return (
    <span className="dsp glow-lime rounded-full bg-[var(--lime)] px-3 py-[5px] text-[11.5px] font-bold text-[#0a0b0d]">
      {t ? t.totalDays : "—"} {tr("countdown.days")}
    </span>
  );
}

export function Countdown({ raceISO = RACE_DATE, locale = DEFAULT_LOCALE }: { raceISO?: string; locale?: Locale }) {
  const tr = translator(locale);
  const [t, setT] = useState<ReturnType<typeof diff> | null>(null);

  useEffect(() => {
    setT(diff(raceISO));
    const id = setInterval(() => setT(diff(raceISO)), 1000);
    return () => clearInterval(id);
  }, [raceISO]);

  const days = t?.totalDays ?? "—";
  const raceLabel = parseISO(raceISO).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div>
      <div className="flex items-end gap-3">
        <span className="dsp tnum text-[80px] font-black leading-[0.86] text-[var(--text)] sm:text-[104px]">
          {days}
        </span>
        <span className="mb-2.5 text-[15px] font-semibold leading-tight text-[var(--text-2)]">
          {tr("hero.daysTo")}<br />{tr("hero.raceDay")}
        </span>
      </div>
      <p className="mt-3 text-[13px] text-[var(--text-muted)]">
        {raceLabel} ·{" "}
        <span className="tnum text-[var(--text-2)]">
          {t ? `${t.weeks} ${tr("countdown.wk")} ${t.days} ${tr("countdown.d")}` : "—"}
        </span>
      </p>
      <p className="tnum mt-1 text-[13px] text-[var(--text-faint)]">
        {t ? `${String(t.hours).padStart(2, "0")}:${String(t.mins).padStart(2, "0")}:${String(t.secs).padStart(2, "0")}` : "--:--:--"}
      </p>
    </div>
  );
}
