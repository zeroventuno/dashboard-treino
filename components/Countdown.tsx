"use client";

import { useEffect, useState } from "react";
import { RACE_DATE } from "@/lib/types";

function diff() {
  const race = new Date(2026, 9, 25, 7, 0, 0); // 25 Oct 2026, gun ~07:00
  const now = new Date();
  let ms = race.getTime() - now.getTime();
  if (ms < 0) ms = 0;
  const totalDays = Math.floor(ms / 86_400_000);
  const weeks = Math.floor(totalDays / 7);
  const days = totalDays % 7;
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return { totalDays, weeks, days, hours, mins, secs };
}

export function Countdown() {
  const [t, setT] = useState<ReturnType<typeof diff> | null>(null);

  useEffect(() => {
    setT(diff());
    const id = setInterval(() => setT(diff()), 1000);
    return () => clearInterval(id);
  }, []);

  // Render a stable placeholder on the server / first paint to avoid hydration mismatch.
  const totalDays = t?.totalDays ?? "—";

  return (
    <div>
      <div className="flex items-end gap-2">
        <span className="tnum text-[64px] font-bold leading-none tracking-tight text-[var(--text)] sm:text-[76px]">
          {totalDays}
        </span>
        <span className="mb-2 text-sm font-medium text-[var(--text-muted)]">dias</span>
      </div>
      <div className="mt-2 flex items-center gap-4 text-[13px] text-[var(--text-muted)]">
        <span className="tnum">
          {t ? `${t.weeks} sem ${t.days}d` : "—"}
        </span>
        <span className="tnum text-[var(--text-faint)]">
          {t ? `${String(t.hours).padStart(2, "0")}:${String(t.mins).padStart(2, "0")}:${String(t.secs).padStart(2, "0")}` : "--:--:--"}
        </span>
      </div>
      <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
        até {RACE_DATE.split("-").reverse().join("/")}
      </p>
    </div>
  );
}
