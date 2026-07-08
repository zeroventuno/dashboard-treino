"use client";

import { Fragment, useEffect } from "react";
import { createPortal } from "react-dom";
import type { Discipline, Workout, WorkoutStatus } from "@/lib/types";
import { DISCIPLINE_META, fmtDuration } from "@/lib/utils";
import { DisciplineIcon, CheckIcon, DownloadIcon, CloseIcon } from "./Icons";

export const STATUS_META: Record<WorkoutStatus, { label: string; dot: string; ring: string }> = {
  planned:  { label: "Planned",   dot: "var(--text-faint)", ring: "var(--border)" },
  done:     { label: "Done",      dot: "var(--good)",       ring: "color-mix(in oklab, var(--good) 45%, var(--border))" },
  skipped:  { label: "Skipped",   dot: "var(--bad)",        ring: "var(--border)" },
  modified: { label: "Modified",  dot: "var(--warn)",       ring: "color-mix(in oklab, var(--warn) 40%, var(--border))" },
};

function downloadZwo(w: Workout) {
  if (!w.zwo_content) return;
  const blob = new Blob([w.zwo_content], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${w.title.replace(/[^\w\-]+/g, "_")}.zwo`;
  a.click();
  URL.revokeObjectURL(url);
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">{label}</p>
      {children}
    </div>
  );
}

function fmtKm(km: number): string {
  return `${km % 1 === 0 ? km : km.toFixed(1)} km`;
}

function fmtMinSec(minutes: number): string {
  let m = Math.floor(minutes);
  let s = Math.round((minutes - m) * 60);
  if (s === 60) { m += 1; s = 0; }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Discipline-appropriate average pace from duration + distance:
 * run → min/km · swim → min/100m · bike → km/h. */
function fmtPace(discipline: Discipline, durationMin: number | null, distanceKm: number | null): string | null {
  if (!durationMin || !distanceKm || distanceKm <= 0 || durationMin <= 0) return null;
  if (discipline === "run") return `${fmtMinSec(durationMin / distanceKm)}/km`;
  if (discipline === "swim") return `${fmtMinSec(durationMin / (distanceKm * 10))}/100m`;
  if (discipline === "bike") return `${(distanceKm / (durationMin / 60)).toFixed(1)} km/h`;
  return null;
}

/** Planned-vs-actual comparison: rows appear only when either side has data. */
function ComparisonTable({ w }: { w: Workout }) {
  const rows = [
    {
      label: "Time",
      planned: w.planned_duration_min != null ? fmtDuration(w.planned_duration_min) : null,
      actual: w.actual_duration_min != null ? fmtDuration(w.actual_duration_min) : null,
    },
    {
      label: "Distance",
      planned: w.planned_distance_km != null ? fmtKm(Number(w.planned_distance_km)) : null,
      actual: w.actual_distance_km != null ? fmtKm(Number(w.actual_distance_km)) : null,
    },
    {
      label: "Avg pace",
      planned: fmtPace(w.discipline, w.planned_duration_min, w.planned_distance_km),
      actual: fmtPace(w.discipline, w.actual_duration_min, w.actual_distance_km),
    },
    {
      label: "Load",
      planned: w.planned_tss != null ? `${Math.round(Number(w.planned_tss))}` : null,
      actual: w.actual_tss != null ? `${Math.round(Number(w.actual_tss))}` : null,
    },
  ].filter((r) => r.planned != null || r.actual != null);

  if (rows.length === 0) return null;

  return (
    <div className="border-b border-[var(--border)] px-5 py-3.5">
      <div className="grid grid-cols-[minmax(72px,auto)_1fr_1fr] items-baseline gap-x-4 gap-y-1.5">
        <span />
        <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">Planned</span>
        <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">Actual</span>
        {rows.map((r) => (
          <Fragment key={r.label}>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{r.label}</span>
            <span className="tnum text-[13px] text-[var(--text-muted)]">{r.planned ?? "—"}</span>
            <span className="tnum text-[13px] font-bold text-[var(--text)]">{r.actual ?? "—"}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export function WorkoutModal({
  w, busy, onClose, onStatus,
}: {
  w: Workout;
  busy: boolean;
  onClose: () => void;
  onStatus: (id: string, s: WorkoutStatus) => void;
}) {
  const meta = DISCIPLINE_META[w.discipline];

  // lock background scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  if (typeof document === "undefined") return null;

  // Portal to <body>: ancestor cards use hover transforms, which turn
  // position:fixed into card-relative positioning — rendering here keeps the
  // overlay (and its blur) covering the whole page, above everything.
  return createPortal(
    <div className="fade fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="pop max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] shadow-2xl sm:rounded-[var(--radius)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)]/95 p-5 backdrop-blur">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: "var(--surface-3)", color: meta.color }}>
              <DisciplineIcon discipline={w.discipline} size={22} />
            </span>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: meta.color }}>
                {meta.label} · {STATUS_META[w.status].label}
              </p>
              <h3 className="text-lg font-bold leading-tight text-[var(--text)]">{w.title}</h3>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
            <CloseIcon />
          </button>
        </div>

        <ComparisonTable w={w} />

        <div className="space-y-5 p-5">
          {w.description && (
            <Section label="Description">
              <pre className="whitespace-pre-wrap font-sans text-[13.5px] leading-relaxed text-[var(--text-muted)]">{w.description}</pre>
            </Section>
          )}
          {w.garmin_instructions && (
            <Section label="Build on Garmin">
              <pre className="whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] p-3.5 font-mono text-[12.5px] leading-relaxed text-[var(--text-muted)]">{w.garmin_instructions}</pre>
            </Section>
          )}
          {w.nutrition_notes && (
            <Section label="🥤 Nutrition">
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--text-muted)]">{w.nutrition_notes}</p>
            </Section>
          )}
          {w.notes && (
            <Section label="Notes">
              <p className="text-[13.5px] italic text-[var(--text-muted)]">{w.notes}</p>
            </Section>
          )}
          {w.discipline === "bike" && w.zwo_content && (
            <button
              onClick={() => downloadZwo(w)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm font-semibold text-[var(--text)] transition-colors hover:border-[var(--lime)] hover:text-[var(--lime)]"
            >
              <DownloadIcon /> Download .zwo file (Zwift)
            </button>
          )}
        </div>

        <div className="sticky bottom-0 flex gap-2 border-t border-[var(--border)] bg-[var(--surface)]/95 p-4 backdrop-blur">
          <button disabled={busy} onClick={() => onStatus(w.id, "done")}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--lime)] px-4 py-2.5 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50">
            <CheckIcon /> Mark done
          </button>
          <button disabled={busy} onClick={() => onStatus(w.id, "modified")}
            className="flex-1 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text-muted)] transition-colors hover:border-[var(--warn)] hover:text-[var(--warn)] disabled:opacity-50">
            Modified
          </button>
          <button disabled={busy} onClick={() => onStatus(w.id, "skipped")}
            className="flex-1 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text-muted)] transition-colors hover:border-[var(--bad)] hover:text-[var(--bad)] disabled:opacity-50">
            Skip
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
