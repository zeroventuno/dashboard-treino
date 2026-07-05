"use client";

import { useEffect, useState } from "react";

function diff() {
  const race = new Date(2026, 9, 25, 7, 0, 0); // 25 Oct 2026, gun ~07:00
  let ms = race.getTime() - Date.now();
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

export function Countdown() {
  const [t, setT] = useState<ReturnType<typeof diff> | null>(null);

  useEffect(() => {
    setT(diff());
    const id = setInterval(() => setT(diff()), 1000);
    return () => clearInterval(id);
  }, []);

  const days = t?.totalDays ?? "—";
  return (
    <div>
      <div className="flex items-end gap-3">
        <span className="dsp tnum text-[80px] font-black leading-[0.86] text-[var(--text)] sm:text-[104px]">
          {days}
        </span>
        <span className="mb-2.5 text-[15px] font-semibold leading-tight text-[var(--text-2)]">
          days to<br />race day
        </span>
      </div>
      <p className="mt-3 text-[13px] text-[var(--text-muted)]">
        Oct 25, 2026 ·{" "}
        <span className="tnum text-[var(--text-2)]">
          {t ? `${t.weeks} wk ${t.days} d to go` : "—"}
        </span>
      </p>
      <p className="tnum mt-1 text-[13px] text-[var(--text-faint)]">
        {t ? `${String(t.hours).padStart(2, "0")}:${String(t.mins).padStart(2, "0")}:${String(t.secs).padStart(2, "0")}` : "--:--:--"}
      </p>
    </div>
  );
}
