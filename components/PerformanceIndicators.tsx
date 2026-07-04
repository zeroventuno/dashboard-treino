import type { PerformanceIndicators } from "@/lib/types";
import { BikeIcon, RunIcon, SwimIcon } from "./Icons";

function ZoneRows({ zones }: { zones: Record<string, string | [number, number]> | null }) {
  if (!zones) return <p className="text-[13px] text-[var(--text-faint)]">Sem dados</p>;
  return (
    <div className="space-y-1.5">
      {Object.entries(zones).map(([name, val]) => (
        <div key={name} className="flex items-center justify-between gap-3 text-[13px]">
          <span className="text-[var(--text-muted)]">{name}</span>
          <span className="tnum font-semibold text-[var(--text)]">
            {Array.isArray(val) ? `${val[0]}–${val[1]}` : val}
          </span>
        </div>
      ))}
    </div>
  );
}

function Block({
  icon, title, headline, sub, children,
}: {
  icon: React.ReactNode; title: string; headline: string; sub?: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[var(--text-muted)]">
          {icon}
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">{title}</span>
        </div>
        <div className="text-right">
          <div className="tnum text-lg font-bold text-[var(--text)] leading-none">{headline}</div>
          {sub && <div className="text-[10px] text-[var(--text-faint)]">{sub}</div>}
        </div>
      </div>
      {children}
    </div>
  );
}

export function PerformanceIndicatorsPanel({ ind }: { ind: PerformanceIndicators | null }) {
  if (!ind) return <p className="text-[13px] text-[var(--text-faint)]">Sem indicadores cadastrados.</p>;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <Block
        icon={<BikeIcon size={16} style={{ color: "var(--bike)" }} />}
        title="Bike"
        headline={ind.ftp_watts ? `${ind.ftp_watts}W` : "—"}
        sub="FTP"
      >
        <ZoneRows zones={ind.bike_zones} />
      </Block>

      <Block
        icon={<RunIcon size={16} style={{ color: "var(--run)" }} />}
        title="Corrida"
        headline={ind.run_threshold_pace ? `${ind.run_threshold_pace}` : "—"}
        sub="limiar /km"
      >
        <ZoneRows zones={ind.run_pace_zones} />
        {ind.cadence_run_target && (
          <div className="mt-2 flex items-center justify-between border-t border-[var(--border)] pt-2 text-[13px]">
            <span className="text-[var(--text-muted)]">Cadência alvo</span>
            <span className="tnum font-semibold text-[var(--text)]">{ind.cadence_run_target} spm</span>
          </div>
        )}
      </Block>

      <Block
        icon={<SwimIcon size={16} style={{ color: "var(--swim)" }} />}
        title="Natação"
        headline={ind.swim_pace_per_100m ? `${ind.swim_pace_per_100m}` : "—"}
        sub="/100m"
      >
        <ZoneRows zones={ind.hr_zones} />
        <p className="mt-2 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--text-faint)]">
          Zonas de FC (bpm)
        </p>
      </Block>
    </div>
  );
}
