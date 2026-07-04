import type { Checkin } from "@/lib/types";
import { avg } from "@/lib/utils";

function Ring({ value, goal, unit, label, precision = 0 }: {
  value: number | null; goal: number; unit: string; label: string; precision?: number;
}) {
  const has = value != null && value > 0;
  const pct = has ? Math.min(1, value! / goal) : 0;
  const ok = has && value! >= goal;
  const R = 26, C = 2 * Math.PI * R;
  const color = !has ? "var(--text-faint)" : ok ? "var(--good)" : "var(--warn)";

  return (
    <div className="flex flex-col items-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-4">
      <div className="relative h-[68px] w-[68px]">
        <svg viewBox="0 0 68 68" className="h-full w-full -rotate-90">
          <circle cx="34" cy="34" r={R} fill="none" stroke="var(--border)" strokeWidth="6" />
          <circle
            cx="34" cy="34" r={R} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - pct)}
            style={{ transition: "stroke-dashoffset .6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum text-base font-bold leading-none text-[var(--text)]">
            {has ? value!.toFixed(precision) : "—"}
          </span>
          <span className="text-[9px] text-[var(--text-faint)]">{unit}</span>
        </div>
      </div>
      <p className="mt-2 text-[12px] font-semibold text-[var(--text)]">{label}</p>
      <p className="tnum text-[10px] text-[var(--text-faint)]">meta {goal}{unit}</p>
    </div>
  );
}

export function LifestyleGoals({ checkins }: { checkins: Checkin[] }) {
  const last7 = checkins.slice(-7);
  const sleeps = last7.map((c) => c.sleep_hours).filter((x): x is number => x != null);
  const sleepAvg = sleeps.length ? +avg(sleeps).toFixed(1) : null;

  // Hidratação e proteína ainda não têm campo no schema — registrados via chat.
  // Mostramos as metas com estado neutro até haver fonte de dados.
  return (
    <div className="grid grid-cols-3 gap-2.5">
      <Ring value={sleepAvg} goal={7.5} unit="h" label="Sono" precision={1} />
      <Ring value={null} goal={3} unit="L" label="Hidratação" />
      <Ring value={null} goal={140} unit="g" label="Proteína" />
    </div>
  );
}
