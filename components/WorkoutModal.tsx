"use client";

import { Fragment, useEffect } from "react";
import { createPortal } from "react-dom";
import type { Discipline, Workout, WorkoutStatus } from "@/lib/types";
import { disciplineMeta, fmtDuration } from "@/lib/utils";
import { getWorkoutBlocks } from "@/lib/workout-structure";
import { DEFAULT_LOCALE, translator, type Locale, type T, type TKey } from "@/lib/i18n";
import { DisciplineIcon, DownloadIcon, CloseIcon } from "./Icons";
import { WorkoutBlocks } from "./WorkoutBlocks";

export const STATUS_META: Record<WorkoutStatus, { key: "status.planned" | "status.done" | "status.skipped" | "status.modified"; dot: string; ring: string }> = {
  planned:  { key: "status.planned",  dot: "var(--text-faint)", ring: "var(--border)" },
  done:     { key: "status.done",     dot: "var(--good)",       ring: "color-mix(in oklab, var(--good) 45%, var(--border))" },
  skipped:  { key: "status.skipped",  dot: "var(--bad)",        ring: "var(--border)" },
  modified: { key: "status.modified", dot: "var(--warn)",       ring: "color-mix(in oklab, var(--warn) 40%, var(--border))" },
};

/** Same reasoning as disciplineMeta: `status` is text in the database, and rows
 * written before the enum reached the tool can hold anything. Falls back to
 * "planned", the neutral state, instead of throwing mid-render. */
function statusMeta(s: string): (typeof STATUS_META)[WorkoutStatus] {
  return STATUS_META[s as WorkoutStatus] ?? STATUS_META.planned;
}

// Status lights — mirror the workout's status set from the training log
// (coach chat), not clickable actions. Planned = all off.
const STATUS_LIGHTS: { status: WorkoutStatus; key: TKey; color: string }[] = [
  { status: "done", key: "status.done", color: "var(--good)" },
  { status: "modified", key: "status.modified", color: "var(--warn)" },
  { status: "skipped", key: "status.skipped", color: "var(--bad)" },
];

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

/** Pre/post-workout grouping — a tinted rail makes the three phases of the
 * session (before → workout → after) scannable at a glance. */
function Phase({ label, tint, children }: { label: string; tint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/40 p-3.5"
      style={{ borderLeft: `2.5px solid ${tint}` }}>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: tint }}>{label}</p>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function SubSection({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text-muted)]">{text}</p>
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

/** Derived average pace fallback (run min/km, bike km/h) when no stored pace
 * exists. Swim is intentionally excluded: session duration includes interval
 * rests, so the derived number misrepresents swim pace — swims only show the
 * stored Garmin value. */
function fmtPace(discipline: Discipline, durationMin: number | null, distanceKm: number | null): string | null {
  if (!durationMin || !distanceKm || distanceKm <= 0 || durationMin <= 0) return null;
  if (discipline === "run") return `${fmtMinSec(durationMin / distanceKm)}/km`;
  if (discipline === "bike") return `${(distanceKm / (durationMin / 60)).toFixed(1)} km/h`;
  return null;
}

/** Planned-vs-actual comparison: rows appear only when either side has data.
 * Pace prefers the stored Garmin value (actual_pace/planned_pace) and only
 * falls back to duration÷distance — the derived number overstates swim pace
 * because elapsed duration includes interval rests. */
function ComparisonTable({ w, tr }: { w: Workout; tr: T }) {
  const rows = [
    {
      label: tr("modal.time"),
      planned: w.planned_duration_min != null ? fmtDuration(Math.round(Number(w.planned_duration_min))) : null,
      actual: w.actual_duration_min != null ? fmtDuration(Math.round(Number(w.actual_duration_min))) : null,
    },
    {
      label: tr("modal.distance"),
      planned: w.planned_distance_km != null ? fmtKm(Number(w.planned_distance_km)) : null,
      actual: w.actual_distance_km != null ? fmtKm(Number(w.actual_distance_km)) : null,
    },
    {
      label: tr("modal.pace"),
      planned: w.planned_pace ?? fmtPace(w.discipline, w.planned_duration_min, w.planned_distance_km),
      actual: w.actual_pace ?? fmtPace(w.discipline, w.actual_duration_min, w.actual_distance_km),
    },
    {
      label: tr("modal.power"),
      planned: w.planned_power_watts ?? null,
      actual: w.actual_power_watts ?? null,
    },
    {
      label: tr("modal.load"),
      planned: w.planned_tss != null ? `${Math.round(Number(w.planned_tss))}` : null,
      actual: w.actual_tss != null ? `${Math.round(Number(w.actual_tss))}` : null,
    },
  ].filter((r) => r.planned != null || r.actual != null);

  if (rows.length === 0) return null;

  return (
    <div className="border-b border-[var(--border)] px-5 py-3.5">
      <div className="grid grid-cols-[minmax(72px,auto)_1fr_1fr] items-baseline gap-x-4 gap-y-1.5">
        <span />
        <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">{tr("modal.planned")}</span>
        <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">{tr("modal.actual")}</span>
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
  w, ftpWatts = null, locale = DEFAULT_LOCALE, onClose,
}: {
  w: Workout;
  locale?: Locale;
  /** Athlete's threshold power — .zwo stores power as a fraction of it. */
  ftpWatts?: number | null;
  onClose: () => void;
}) {
  const tr = translator(locale);
  const meta = disciplineMeta(w.discipline);
  // coach-authored blocks, else derived from the .zwo (free for bike workouts)
  const blocks = getWorkoutBlocks(w, ftpWatts);

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
              <p className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: meta.color }}>
                <span>{tr(meta.i18nKey)} · {tr(statusMeta(w.status).key)}</span>
                {w.key_workout && (
                  <span className="rounded-full px-2 py-[2px] text-[9.5px] tracking-[0.1em] text-[var(--lime)]"
                    style={{ background: "color-mix(in oklab, var(--lime) 16%, transparent)" }}>
                    ★ {tr("modal.keyWorkout")}
                  </span>
                )}
              </p>
              <h3 className="text-lg font-bold leading-tight text-[var(--text)]">{w.title}</h3>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]">
            <CloseIcon />
          </button>
        </div>

        <ComparisonTable w={w} tr={tr} />

        <div className="space-y-5 p-5">
          {w.description && (
            <Section label={tr("modal.description")}>
              <pre className="whitespace-pre-wrap font-sans text-[13.5px] leading-relaxed text-[var(--text-muted)]">{w.description}</pre>
            </Section>
          )}

          {/* ── Pre-workout ───────────────────────────────────────────── */}
          {(w.activation || w.nutrition_pre) && (
            <Phase label={tr("modal.preWorkout")} tint="var(--teal)">
              {w.activation && <SubSection label={tr("modal.activation")} text={w.activation} />}
              {w.nutrition_pre && <SubSection label={"🥤 " + tr("modal.nutritionPre")} text={w.nutrition_pre} />}
            </Phase>
          )}

          {/* ── The workout itself ────────────────────────────────────── */}
          {(blocks.length > 0 || w.garmin_instructions) && (
            <Section label={tr("modal.build")}>
              {blocks.length > 0 && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] p-3.5">
                  <WorkoutBlocks blocks={blocks} discipline={w.discipline} locale={locale} />
                </div>
              )}
              {w.garmin_instructions && (
                <pre className={`whitespace-pre-wrap rounded-xl border border-[var(--border)] bg-[var(--bg-soft)] p-3.5 font-mono text-[12.5px] leading-relaxed text-[var(--text-muted)] ${blocks.length > 0 ? "mt-2.5" : ""}`}>
                  {w.garmin_instructions}
                </pre>
              )}
            </Section>
          )}

          {/* ── Post-workout ──────────────────────────────────────────── */}
          {(w.mobility || w.nutrition_post) && (
            <Phase label={tr("modal.postWorkout")} tint="var(--strength)">
              {w.mobility && <SubSection label={tr("modal.mobility")} text={w.mobility} />}
              {w.nutrition_post && <SubSection label={"🥤 " + tr("modal.nutritionPost")} text={w.nutrition_post} />}
            </Phase>
          )}

          {w.nutrition_notes && (
            <Section label={"🥤 " + tr("modal.nutrition")}>
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--text-muted)]">{w.nutrition_notes}</p>
            </Section>
          )}
          {w.notes && (
            <Section label={tr("modal.notes")}>
              <p className="text-[13.5px] italic text-[var(--text-muted)]">{w.notes}</p>
            </Section>
          )}
          {w.discipline === "bike" && w.zwo_content && (
            <button
              onClick={() => downloadZwo(w)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm font-semibold text-[var(--text)] transition-colors hover:border-[var(--lime)] hover:text-[var(--lime)]"
            >
              <DownloadIcon /> {tr("modal.download")}
            </button>
          )}
        </div>

        {/* status lights — reflect the status set in the training log, not actions */}
        <div className="sticky bottom-0 border-t border-[var(--border)] bg-[var(--surface)]/95 p-4 backdrop-blur">
          <div className="flex items-center justify-center gap-7">
            {STATUS_LIGHTS.map((l) => {
              const on = w.status === l.status;
              return (
                <div key={l.status} className="flex items-center gap-2" style={{ opacity: on ? 1 : 0.4 }}>
                  <span
                    className="h-2.5 w-2.5 rounded-full transition-all"
                    style={{
                      background: on ? l.color : "var(--surface-3)",
                      color: l.color,
                      boxShadow: on ? "0 0 12px currentColor" : "none",
                    }}
                  />
                  <span
                    className="text-[12px] font-bold uppercase tracking-[0.08em]"
                    style={{ color: on ? l.color : "var(--text-faint)" }}
                  >
                    {tr(l.key)}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-center text-[10px] text-[var(--text-faint)]">
            {tr("modal.statusHint")}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
