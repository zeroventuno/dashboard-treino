"use client";

import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Discipline, PerformanceIndicators, Workout, WorkoutStatus } from "@/lib/types";
import { prescribe, type Equipment } from "@/lib/prescription";
import { disciplineMeta, fmtDuration, toDistance, distanceUnit, toSpeed, speedUnit, computeAdherence, type Units } from "@/lib/utils";
import { ZoneCompare } from "@/components/ZoneCompare";
import { plannedZones } from "@/lib/zone-time";
import { getWorkoutBlocks, buildZwo } from "@/lib/workout-structure";
import { buildFitWorkout } from "@/lib/fit-workout";
import { DEFAULT_LOCALE, translator, type Locale, type T, type TKey } from "@/lib/i18n";
import { DisciplineIcon, DownloadIcon, CloseIcon } from "./Icons";
import { WorkoutBlocks } from "./WorkoutBlocks";
import { AdherenceDonut } from "./AdherenceDonut";

export const STATUS_META: Record<
  WorkoutStatus,
  { key: "status.planned" | "status.done" | "status.skipped" | "status.cancelled" | "status.moved"; dot: string; ring: string }
> = {
  planned:   { key: "status.planned",   dot: "var(--text-faint)", ring: "var(--border)" },
  done:      { key: "status.done",      dot: "var(--good)",       ring: "color-mix(in oklab, var(--good) 45%, var(--border))" },
  skipped:   { key: "status.skipped",   dot: "var(--bad)",        ring: "var(--border)" },
  cancelled: { key: "status.cancelled", dot: "var(--text-faint)", ring: "var(--border)" },
  moved:     { key: "status.moved",     dot: "var(--text-faint)", ring: "var(--border)" },
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
  { status: "skipped", key: "status.skipped", color: "var(--bad)" },
  { status: "cancelled", key: "status.cancelled", color: "var(--text-faint)" },
  { status: "moved", key: "status.moved", color: "var(--text-faint)" },
];

function saveAs(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const fileBase = (w: Workout) => w.title.replace(/[^\w\-]+/g, "_");

/** Garmin's binary workout file — built in code, since no AI can type a binary.
 * This is the run/swim path to a watch-ready session. */
function downloadFit(w: Workout, bytes: Uint8Array) {
  saveAs(new Blob([bytes as BlobPart], { type: "application/octet-stream" }), `${fileBase(w)}.fit`);
}

/** The coach's own file wins; otherwise we synthesize one from the blocks, so a
 * bike session doesn't lose its download just because the AI skipped the XML. */
function downloadZwo(w: Workout, xml: string) {
  const blob = new Blob([xml], { type: "application/xml" });
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

function fmtKm(km: number, units: Units): string {
  const v = toDistance(km, units);
  return `${v % 1 === 0 ? v : v.toFixed(1)} ${distanceUnit(units)}`;
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
 * stored Garmin value.
 *
 * Bike speed converts to mph for imperial; run pace stays min/km for now (pace
 * conversion was deliberately out of the distance+weight scope). */
function fmtPace(discipline: Discipline, durationMin: number | null, distanceKm: number | null, units: Units): string | null {
  if (!durationMin || !distanceKm || distanceKm <= 0 || durationMin <= 0) return null;
  if (discipline === "run") return `${fmtMinSec(durationMin / distanceKm)}/km`;
  if (discipline === "bike") return `${toSpeed(distanceKm / (durationMin / 60), units).toFixed(1)} ${speedUnit(units)}`;
  return null;
}

/** Planned-vs-actual comparison: rows appear only when either side has data.
 * Pace prefers the stored Garmin value (actual_pace/planned_pace) and only
 * falls back to duration÷distance — the derived number overstates swim pace
 * because elapsed duration includes interval rests. */
function ComparisonTable({ w, tr, units }: { w: Workout; tr: T; units: Units }) {
  const rows = [
    {
      label: tr("modal.time"),
      planned: w.planned_duration_min != null ? fmtDuration(Math.round(Number(w.planned_duration_min))) : null,
      actual: w.actual_duration_min != null ? fmtDuration(Math.round(Number(w.actual_duration_min))) : null,
    },
    {
      label: tr("modal.distance"),
      planned: w.planned_distance_km != null ? fmtKm(Number(w.planned_distance_km), units) : null,
      actual: w.actual_distance_km != null ? fmtKm(Number(w.actual_distance_km), units) : null,
    },
    {
      label: tr("modal.pace"),
      planned: w.planned_pace ?? fmtPace(w.discipline, w.planned_duration_min, w.planned_distance_km, units),
      actual: w.actual_pace ?? fmtPace(w.discipline, w.actual_duration_min, w.actual_distance_km, units),
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

  const score = computeAdherence(w);
  if (rows.length === 0 && score == null) return null;

  return (
    <div className="border-b border-[var(--border)] px-5 py-3.5">
      <div className="flex items-center gap-4">
        {rows.length > 0 && (
          <div className="grid flex-1 grid-cols-[minmax(72px,auto)_1fr_1fr] items-baseline gap-x-4 gap-y-1.5">
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
        )}
        {score != null && (
          <div className={rows.length === 0 ? "flex-1" : "shrink-0"}>
            <AdherenceDonut score={score} size={54} label={tr("modal.adherence")} />
          </div>
        )}
      </div>
    </div>
  );
}

export function WorkoutModal({
  w, ftpWatts = null, locale = DEFAULT_LOCALE, units = "metric", onClose, onMove, tags,
  indicators = null, equipment = [],
}: {
  w: Workout;
  locale?: Locale;
  units?: Units;
  /** Athlete's threshold power — .zwo stores power as a fraction of it. */
  ftpWatts?: number | null;
  /** The athlete's zone tables, and what they can measure. Together these turn
   * a block's bare percentage into a target they can act on — watts, pace, bpm
   * or RPE. See lib/prescription. */
  indicators?: PerformanceIndicators | null;
  equipment?: Equipment[];
  onClose: () => void;
  /** Present when this session can be rescheduled — the touch/keyboard path to
   * the same move that dragging performs on desktop. */
  onMove?: (iso: string) => void;
  /** Library classification, shown when the coach opens a bank item. */
  tags?: string[] | null;
}) {
  const tr = translator(locale);
  const meta = disciplineMeta(w.discipline);
  // coach-authored blocks, else derived from the .zwo (free for bike workouts)
  // Fill in a target for every block the coach left as a bare percentage, in
  // whichever unit this athlete can actually measure. `prescribe` returns the
  // coach's own wording untouched when they wrote one, so this map is safe to
  // run over everything.
  const blocks = getWorkoutBlocks(w, ftpWatts).map((b) => {
    if (b.target) return b;
    const p = prescribe(b, w.discipline, equipment, indicators);
    return p ? { ...b, target: p.target } : b;
  });
  // Coach-supplied file first; else synthesized from the blocks (see buildZwo).
  const zwo = w.zwo_content ?? (w.discipline === "bike" ? buildZwo(w, blocks) : null);
  // Garmin file for the three endurance disciplines — strength workouts are
  // sets and reps, which this encoder doesn't model.
  const fit = ["swim", "bike", "run"].includes(w.discipline) ? buildFitWorkout(w, blocks) : null;
  const [moveDate, setMoveDate] = useState(w.date);

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

        <ComparisonTable w={w} tr={tr} units={units} />

        {/* Only when the device gave us a stream to reduce. Everyone else keeps
            the table above and loses nothing. */}
        <ZoneCompare planned={plannedZones(blocks)} actual={w.actual_zones ?? null} locale={locale} />

        <div className="space-y-5 p-5">
          {tags && tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t} className="rounded-[6px] bg-[var(--surface-2)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">
                  #{t}
                </span>
              ))}
            </div>
          )}
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
          {onMove && (
            <Section label={tr("modal.reschedule")}>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={moveDate}
                  onChange={(e) => setMoveDate(e.target.value)}
                  className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--lime)]"
                />
                <button
                  type="button"
                  onClick={() => onMove(moveDate)}
                  disabled={!moveDate || moveDate === w.date}
                  className="rounded-[10px] bg-[var(--lime)] px-4 py-2 text-[13px] font-bold text-[#0a0b0d] transition-opacity disabled:opacity-40"
                >
                  {tr("modal.move")}
                </button>
              </div>
              <p className="mt-1.5 text-[11.5px] text-[var(--text-faint)]">{tr("modal.rescheduleHint")}</p>
            </Section>
          )}

          {(zwo || fit) && (
            <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 sm:flex-row">
              {w.discipline === "bike" && zwo && (
                <button
                  onClick={() => downloadZwo(w, zwo)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm font-semibold text-[var(--text)] transition-colors hover:border-[var(--lime)] hover:text-[var(--lime)]"
                >
                  <DownloadIcon /> {tr("modal.download")}
                </button>
              )}
              {fit && (
                <button
                  onClick={() => downloadFit(w, fit)}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-sm font-semibold text-[var(--text)] transition-colors hover:border-[var(--lime)] hover:text-[var(--lime)]"
                >
                  <DownloadIcon /> {tr("modal.downloadFit")}
                </button>
              )}
            </div>
            {/* Garmin Connect's import only takes RECORDED activities, not
                planned workouts — so a .fit workout reaches the watch over USB,
                or the athlete rebuilds it in Connect from garmin_instructions.
                Saying so here saves everyone the same dead end. */}
            {fit && <p className="text-[11.5px] leading-relaxed text-[var(--text-faint)]">{tr("modal.fitHint")}</p>}
            </div>
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
