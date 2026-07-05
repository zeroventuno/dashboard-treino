"use client";

import type { Workout, WorkoutStatus } from "@/lib/types";
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

export function WorkoutModal({
  w, busy, onClose, onStatus,
}: {
  w: Workout;
  busy: boolean;
  onClose: () => void;
  onStatus: (id: string, s: WorkoutStatus) => void;
}) {
  const meta = DISCIPLINE_META[w.discipline];
  return (
    <div className="fade fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
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
              <p className="tnum mt-0.5 text-[12px] text-[var(--text-faint)]">
                {fmtDuration(w.planned_duration_min)}{w.planned_tss ? ` · ${w.planned_tss} TSS planned` : ""}
                {w.actual_tss ? ` · ${w.actual_tss} TSS actual` : ""}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
            <CloseIcon />
          </button>
        </div>

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
    </div>
  );
}
