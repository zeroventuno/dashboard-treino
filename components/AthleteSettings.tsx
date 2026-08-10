"use client";

// The athlete's own configuration, behind a gear.
//
// "My week" and the equipment list are the only two things on this dashboard
// the athlete fills in about THEMSELVES rather than reads about their training.
// As blocks they competed with the calendar and the fitness chart for the same
// attention every single day, to be touched roughly twice a year. Behind a gear
// they stop being noise — and a badge brings them back the moment they matter.
//
// The coach still sees "My week" as a block on their drill-in, because for them
// it is information, not configuration. Same component, `variant="card"`.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AvailabilityBlock } from "@/components/blocks/AvailabilityBlock";
import { CloseIcon } from "@/components/Icons";
import { translator, type Locale } from "@/lib/i18n";
import type { Availability } from "@/lib/availability";

/**
 * Has this athlete ever answered the configuration?
 *
 * Not "is anything filled in" — that can't tell an athlete who measures nothing
 * and trains whenever from one who has never opened the panel, and both would
 * keep a red dot forever. An explicit stamp, written by the Done button, is the
 * only thing that distinguishes an answer from a silence.
 */
export function isConfigured(p: Availability | null | undefined): boolean {
  return typeof p?.configured_at === "string" && p.configured_at.length > 0;
}

export function AthleteSettings({
  preferences,
  locale,
  editable,
}: {
  preferences: Availability;
  locale: Locale;
  editable: boolean;
}) {
  const tr = translator(locale);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(() => isConfigured(preferences));
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Escape closes, and the page behind stops scrolling while it's open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  async function markDone() {
    setSaving(true);
    try {
      await fetch("/api/app/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ configured_at: new Date().toISOString() }),
      });
      setDone(true);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const badge = editable && !done;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={tr("settings.title")}
        title={tr("settings.title")}
        className="relative grid h-[30px] w-[30px] place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition-colors hover:border-[var(--lime)] hover:text-[var(--text)]"
      >
        <GearIcon />
        {badge && (
          <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--bad)] opacity-70" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--bad)]" />
          </span>
        )}
      </button>

      {open && mounted &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm sm:p-8"
            onClick={() => setOpen(false)}
          >
            <div
              className="pop w-full max-w-[880px] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
                <div>
                  <h2 className="dsp text-[19px] font-extrabold text-[var(--text)]">{tr("settings.title")}</h2>
                  <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">{tr("settings.sub")}</p>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label={tr("athletes.close")}
                  className="shrink-0 rounded-full p-1 text-[var(--text-faint)] transition-colors hover:text-[var(--text)]"
                >
                  <CloseIcon />
                </button>
              </div>

              <div className="p-5">
                <AvailabilityBlock
                  preferences={preferences}
                  locale={locale}
                  editable={editable}
                  variant="bare"
                />
              </div>

              {editable && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-4">
                  {/* Changes save as they're made — this button only records that
                      the athlete has been here, which is what clears the badge.
                      Without it, someone who measures nothing and trains whenever
                      would be nagged forever for having nothing to say. */}
                  <p className="text-[11.5px] text-[var(--text-faint)]">{tr("settings.autosave")}</p>
                  <button
                    onClick={markDone}
                    disabled={saving}
                    className="rounded-full bg-[var(--lime)] px-5 py-2 text-[13px] font-bold text-[#0a0b0d] transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {tr("settings.done")}
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
