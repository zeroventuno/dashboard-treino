"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Workout, WorkoutStatus } from "@/lib/types";
import { DISCIPLINE_META, fmtDuration, parseDate, startOfWeek, addDays, toISO, weekdayShort } from "@/lib/utils";
import { DisciplineIcon, CheckIcon, DownloadIcon, CloseIcon } from "./Icons";

const STATUS_STYLE: Record<WorkoutStatus, { label: string; dot: string; ring: string }> = {
  planned:  { label: "Planejado", dot: "var(--text-faint)", ring: "var(--border)" },
  done:     { label: "Concluído", dot: "var(--good)",       ring: "color-mix(in oklab, var(--good) 45%, var(--border))" },
  skipped:  { label: "Pulado",    dot: "var(--bad)",        ring: "var(--border)" },
  modified: { label: "Modificado",dot: "var(--warn)",       ring: "color-mix(in oklab, var(--warn) 40%, var(--border))" },
};

export function WeekBoard({ workouts, todayISO }: { workouts: Workout[]; todayISO: string }) {
  const [open, setOpen] = useState<Workout | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const week = useMemo(() => {
    const mon = startOfWeek(parseDate(todayISO));
    return Array.from({ length: 7 }, (_, i) => {
      const iso = toISO(addDays(mon, i));
      return { iso, date: parseDate(iso), items: workouts.filter((w) => w.date === iso) };
    });
  }, [workouts, todayISO]);

  async function update(id: string, status: WorkoutStatus) {
    setBusy(true);
    try {
      const res = await fetch("/api/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const json = await res.json();
      if (!json.ok) {
        setOpen((w) => (w ? { ...w, status } : w)); // optimistic even on mock
        console.warn(json.error);
      } else {
        router.refresh();
      }
      setOpen((w) => (w ? { ...w, status } : w));
    } finally {
      setBusy(false);
    }
  }

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

  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
        {week.map((day) => {
          const isToday = day.iso === todayISO;
          return (
            <div key={day.iso} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between px-1">
                <span className={`text-[11px] font-semibold uppercase tracking-[0.1em] ${isToday ? "text-[var(--surge)]" : "text-[var(--text-faint)]"}`}>
                  {weekdayShort(day.date)}
                </span>
                <span className={`tnum text-[11px] ${isToday ? "text-[var(--surge)]" : "text-[var(--text-faint)]"}`}>
                  {day.date.getDate()}
                </span>
              </div>

              {day.items.length === 0 && (
                <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border-soft)] px-2 py-4 text-center text-[11px] text-[var(--text-faint)]">
                  —
                </div>
              )}

              {day.items.map((w) => {
                const meta = DISCIPLINE_META[w.discipline];
                const st = STATUS_STYLE[w.status];
                return (
                  <button
                    key={w.id}
                    onClick={() => setOpen(w)}
                    className="group relative overflow-hidden rounded-[var(--radius-sm)] border bg-[var(--surface-2)] p-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-[var(--text-faint)] hover:shadow-lg"
                    style={{ borderColor: st.ring }}
                  >
                    <span className="absolute left-0 top-0 h-full w-[3px]" style={{ background: meta.color, opacity: 0.85 }} />
                    <div className="flex items-center gap-1.5">
                      <DisciplineIcon discipline={w.discipline} size={16} className="shrink-0" style={{ color: meta.color }} />
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: st.dot }} />
                    </div>
                    <p className={`mt-1.5 line-clamp-2 text-[12px] font-semibold leading-tight ${w.status === "skipped" ? "text-[var(--text-faint)] line-through" : "text-[var(--text)]"}`}>
                      {w.title}
                    </p>
                    <p className="tnum mt-1 text-[10px] text-[var(--text-faint)]">
                      {fmtDuration(w.planned_duration_min)}
                      {w.planned_tss ? ` · ${w.planned_tss} TSS` : ""}
                    </p>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {open && (
        <WorkoutModal
          w={open}
          busy={busy}
          onClose={() => setOpen(null)}
          onStatus={update}
          onDownload={downloadZwo}
        />
      )}
    </>
  );
}

function WorkoutModal({
  w, busy, onClose, onStatus, onDownload,
}: {
  w: Workout;
  busy: boolean;
  onClose: () => void;
  onStatus: (id: string, s: WorkoutStatus) => void;
  onDownload: (w: Workout) => void;
}) {
  const meta = DISCIPLINE_META[w.discipline];
  return (
    <div
      className="fade fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="pop max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] shadow-2xl sm:rounded-[var(--radius)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)]/95 p-5 backdrop-blur">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: "var(--surface-2)", color: meta.color }}>
              <DisciplineIcon discipline={w.discipline} size={22} />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: meta.color }}>
                {meta.label} · {STATUS_STYLE[w.status].label}
              </p>
              <h3 className="text-lg font-bold leading-tight text-[var(--text)]">{w.title}</h3>
              <p className="tnum mt-0.5 text-[12px] text-[var(--text-faint)]">
                {fmtDuration(w.planned_duration_min)}{w.planned_tss ? ` · ${w.planned_tss} TSS planejado` : ""}
                {w.actual_tss ? ` · ${w.actual_tss} TSS real` : ""}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
            <CloseIcon />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {w.description && (
            <Section label="Descrição">
              <pre className="whitespace-pre-wrap font-sans text-[13.5px] leading-relaxed text-[var(--text-muted)]">{w.description}</pre>
            </Section>
          )}
          {w.garmin_instructions && (
            <Section label="Montar no Garmin">
              <pre className="whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] p-3.5 font-mono text-[12.5px] leading-relaxed text-[var(--text-muted)]">{w.garmin_instructions}</pre>
            </Section>
          )}
          {w.notes && (
            <Section label="Notas">
              <p className="text-[13.5px] italic text-[var(--text-muted)]">{w.notes}</p>
            </Section>
          )}

          {w.discipline === "bike" && w.zwo_content && (
            <button
              onClick={() => onDownload(w)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm font-semibold text-[var(--text)] transition-colors hover:border-[var(--surge)] hover:text-[var(--surge)]"
            >
              <DownloadIcon /> Baixar arquivo .zwo (Zwift)
            </button>
          )}
        </div>

        <div className="sticky bottom-0 flex gap-2 border-t border-[var(--border)] bg-[var(--surface)]/95 p-4 backdrop-blur">
          <button
            disabled={busy}
            onClick={() => onStatus(w.id, "done")}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--surge)] px-4 py-2.5 text-sm font-bold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <CheckIcon /> Concluir
          </button>
          <button
            disabled={busy}
            onClick={() => onStatus(w.id, "modified")}
            className="flex-1 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text-muted)] transition-colors hover:border-[var(--warn)] hover:text-[var(--warn)] disabled:opacity-50"
          >
            Modificado
          </button>
          <button
            disabled={busy}
            onClick={() => onStatus(w.id, "skipped")}
            className="flex-1 rounded-xl border border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text-muted)] transition-colors hover:border-[var(--bad)] hover:text-[var(--bad)] disabled:opacity-50"
          >
            Pular
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">{label}</p>
      {children}
    </div>
  );
}
