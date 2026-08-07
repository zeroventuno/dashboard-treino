"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { translator, type Locale } from "@/lib/i18n";
import type { BankWorkout, RosterAthlete } from "@/lib/product-db";

/**
 * Send one library workout to many athletes at once.
 *
 * Grouped by training phase, because the phase is the cohort — everyone in Base
 * trains alike, and that similarity is the whole reason a coach can hold 200
 * athletes instead of 30. Picking a phase header selects the cohort in one
 * click; the workout's own phase is pre-selected, since that's the group it was
 * written for.
 *
 * Athletes needing individual judgment (red light today, an open injury) are
 * flagged but NOT excluded: the coach decides. Hiding them would quietly drop
 * people from a plan, which is worse than showing a warning.
 */
export function PrescribeModal({
  workout,
  roster,
  todayISO,
  locale,
  onClose,
}: {
  workout: BankWorkout;
  roster: RosterAthlete[];
  todayISO: string;
  locale: Locale;
  onClose: () => void;
}) {
  const tr = translator(locale);
  const [date, setDate] = useState(todayISO);
  // Pre-select the cohort this workout was written for — the common case is
  // "the Base session goes to everyone in Base". Computed in the initializer so
  // it happens once, on open, and the coach's edits are never overwritten.
  const [picked, setPicked] = useState<string[]>(() =>
    workout.phase
      ? roster.filter((a) => a.current_phase === workout.phase).map((a) => a.tenant_id)
      : [],
  );
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [result, setResult] = useState<{ written: number; skipped: number } | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, RosterAthlete[]>();
    for (const a of roster) {
      const key = a.current_phase ?? "—";
      (map.get(key) ?? map.set(key, []).get(key)!).push(a);
    }
    return [...map.entries()].sort(([x], [y]) => x.localeCompare(y));
  }, [roster]);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function send() {
    if (picked.length === 0 || !date) return;
    setState("saving");
    try {
      const res = await fetch("/api/coach/prescribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutId: workout.id, tenantIds: picked, date }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) { setState("error"); return; }
      setResult({ written: data.written, skipped: data.skipped });
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fade fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="pop max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] shadow-2xl sm:rounded-[var(--radius)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[var(--border)] p-5">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--lime)]">
            {tr("prescribe.title")}
          </p>
          <h3 className="mt-0.5 text-lg font-bold leading-tight text-[var(--text)]">{workout.title}</h3>
          <p className="mt-0.5 text-[12px] text-[var(--text-faint)]">
            {[workout.phase, workout.duration_min ? `${workout.duration_min}min` : null,
              workout.tss ? `TSS ${workout.tss}` : null].filter(Boolean).join(" · ")}
          </p>
        </div>

        {state === "done" && result ? (
          <div className="p-5">
            <p className="text-[14px] font-bold text-[var(--good)]">
              {tr("prescribe.done").replace("{n}", String(result.written))}
            </p>
            <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">{tr("prescribe.doneHint")}</p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-[10px] bg-[var(--lime)] px-4 py-2.5 text-[13px] font-bold text-[#0a0b0d]"
            >
              {tr("prescribe.close")}
            </button>
          </div>
        ) : (
          <>
            <div className="border-b border-[var(--border)] p-5">
              <label className="block">
                <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
                  {tr("prescribe.date")}
                </span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--lime)]"
                />
              </label>
            </div>

            <div className="p-5">
              {roster.length === 0 ? (
                <p className="text-[13px] text-[var(--text-faint)]">{tr("prescribe.noRoster")}</p>
              ) : (
                groups.map(([phase, list]) => {
                  const ids = list.map((a) => a.tenant_id);
                  const allOn = ids.every((id) => picked.includes(id));
                  return (
                    <div key={phase} className="mb-4">
                      <label className="mb-1.5 flex items-center gap-2 px-1">
                        <input
                          type="checkbox"
                          checked={allOn}
                          onChange={(e) =>
                            setPicked((p) =>
                              e.target.checked
                                ? [...new Set([...p, ...ids])]
                                : p.filter((x) => !ids.includes(x)),
                            )
                          }
                          className="h-3.5 w-3.5 accent-[var(--lime)]"
                        />
                        <span className="text-[11.5px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
                          {phase === "—" ? tr("coach.noPhase") : phase}
                        </span>
                        <span className="tnum text-[11px] text-[var(--text-faint)]">{list.length}</span>
                      </label>

                      <div className="flex flex-col divide-y divide-[var(--border-soft)] rounded-[10px] border border-[var(--border-soft)]">
                        {list.map((a) => {
                          const needsLook = a.today_reco === "red" || a.recent_injuries > 0;
                          return (
                            <label key={a.tenant_id} className="flex items-center gap-2.5 px-3 py-2">
                              <input
                                type="checkbox"
                                checked={picked.includes(a.tenant_id)}
                                onChange={() => toggle(a.tenant_id)}
                                className="h-3.5 w-3.5 accent-[var(--lime)]"
                              />
                              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text)]">
                                {a.athlete ?? a.name}
                              </span>
                              {/* Flagged, never hidden — silently dropping someone
                                  from a plan is worse than a warning. */}
                              {needsLook && (
                                <span className="shrink-0 text-[10.5px] font-semibold text-[var(--warn)]">
                                  {tr("prescribe.check")}
                                </span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="sticky bottom-0 flex items-center gap-2 border-t border-[var(--border)] bg-[var(--surface)]/95 p-4 backdrop-blur">
              <span className="text-[12.5px] text-[var(--text-muted)]">
                {picked.length} {tr("prescribe.selected")}
              </span>
              {state === "error" && (
                <span className="text-[12px] text-[var(--bad)]">{tr("admin.saveError")}</span>
              )}
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-[10px] border border-[var(--border)] px-3 py-2 text-[12.5px] font-medium text-[var(--text-muted)]"
                >
                  {tr("coach.bank.cancel")}
                </button>
                <button
                  type="button"
                  onClick={send}
                  disabled={picked.length === 0 || state === "saving"}
                  className="rounded-[10px] bg-[var(--lime)] px-4 py-2 text-[12.5px] font-bold text-[#0a0b0d] disabled:opacity-40"
                >
                  {state === "saving" ? "…" : tr("prescribe.send")}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
