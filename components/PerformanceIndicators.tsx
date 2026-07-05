import type { PerformanceIndicators } from "@/lib/types";
import { BikeIcon, RunIcon, SwimIcon } from "./Icons";

function ZoneRows({ zones }: { zones: Record<string, string | [number, number]> | null }) {
  if (!zones || Object.keys(zones).length === 0)
    return <p className="text-[13px] text-[var(--text-faint)]">No zones set</p>;
  const entries = Object.entries(zones);
  const n = entries.length;
  return (
    <div className="space-y-2">
      {entries.map(([name, val], i) => {
        const frac = (i + 1) / n;
        const fill = `color-mix(in oklab, var(--lime) ${Math.round(90 - i * (70 / Math.max(1, n - 1)))}%, #4b5057)`;
        return (
          <div key={name}>
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-[var(--text-muted)]">{name}</span>
              <span className="tnum font-semibold text-[var(--text)]">
                {Array.isArray(val) ? `${val[0]}–${val[1]}` : val}
              </span>
            </div>
            <div className="mt-1 h-[5px] w-full overflow-hidden rounded-full bg-[#1a1d23]">
              <div className="h-full rounded-full" style={{ width: `${30 + frac * 70}%`, background: fill }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Block({ icon, title, headline, sub, children }: {
  icon: React.ReactNode; title: string; headline: string; sub: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[var(--text-muted)]">
          {icon}
          <span className="text-[11px] font-bold uppercase tracking-[0.12em]">{title}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="dsp tnum text-[22px] font-extrabold leading-none text-[var(--text)]">{headline}</span>
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">{sub}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

export function PerformanceZones({ ind }: { ind: PerformanceIndicators | null }) {
  if (!ind) return <p className="text-[13px] text-[var(--text-faint)]">No performance data yet.</p>;

  const updated = ind.updated_at
    ? new Date(ind.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "—";

  return (
    <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Block icon={<BikeIcon size={16} style={{ color: "var(--bike)" }} />} title="Bike"
          headline={ind.ftp_watts ? `${ind.ftp_watts} W` : "—"} sub="FTP">
          <ZoneRows zones={ind.bike_zones} />
        </Block>

        <Block icon={<RunIcon size={16} style={{ color: "var(--run)" }} />} title="Run"
          headline={ind.run_threshold_pace ? `${ind.run_threshold_pace}` : "—"} sub="/km LT">
          <ZoneRows zones={ind.run_pace_zones} />
          {ind.cadence_run_target && (
            <div className="mt-2 flex items-center justify-between border-t border-[var(--border)] pt-2 text-[13px]">
              <span className="text-[var(--text-muted)]">Cadence target</span>
              <span className="tnum font-semibold text-[var(--text)]">{ind.cadence_run_target} spm</span>
            </div>
          )}
        </Block>

        <Block icon={<SwimIcon size={16} style={{ color: "var(--swim)" }} />} title="Swim · HR"
          headline={ind.swim_pace_per_100m ? `${ind.swim_pace_per_100m}` : "—"} sub="/100m CSS">
          <ZoneRows zones={ind.hr_zones} />
          <p className="mt-2 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--text-faint)]">Heart-rate zones (bpm)</p>
        </Block>
      </div>
      <p className="mt-3 text-[11px] text-[var(--text-faint)]">Updated {updated} · zones synced from Strava</p>
    </>
  );
}
