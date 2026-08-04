"use client";

import { useEffect, useRef, useState } from "react";
import { translator, type Locale } from "@/lib/i18n";
import { Icon } from "@/components/coach/icons";

const SEEN_KEY = "trak_briefing_seen";

/** Athlete-side notifications bell. For now it carries one notice — a new
 * briefing version to re-paste to the coach — but it's the home for future
 * alerts too. The "new" dot shows until the athlete opens the panel. */
export function AppNotifications({
  briefing,
  briefingVersion,
  locale,
}: {
  briefing: string;
  briefingVersion: number;
  locale: Locale;
}) {
  const tr = translator(locale);
  const [open, setOpen] = useState(false);
  // Default to "seen" so the server render and first paint carry no dot; the
  // effect reveals it only if the stored version is actually behind.
  const [seen, setSeen] = useState(briefingVersion);
  const [copied, setCopied] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSeen(Number(localStorage.getItem(SEEN_KEY) ?? 0));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const briefingNew = briefingVersion > seen;

  function markSeen() {
    localStorage.setItem(SEEN_KEY, String(briefingVersion));
    setSeen(briefingVersion);
  }

  function toggle() {
    setOpen((o) => {
      if (!o) markSeen(); // opening = acknowledging
      return !o;
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(briefing);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard refused — the athlete can still select the text */
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={tr("app.notif.title")}
        className="relative grid h-8 w-8 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition-colors hover:border-[var(--text)] hover:text-[var(--text)]"
      >
        <Icon name="bell" size={17} />
        {briefingNew && (
          <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-[var(--bad)] ring-2 ring-[rgba(38,43,52,1)]" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[320px] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow)]">
          <p className="px-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
            {tr("app.notif.title")}
          </p>

          <div className="mt-2 rounded-[12px] border border-[var(--border-soft)] bg-[var(--surface-2)] p-3">
            <p className="text-[12.5px] font-semibold text-[var(--text)]">{tr("app.notif.briefing.title")}</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
              {tr("app.notif.briefing.body")}
            </p>
            <button
              type="button"
              onClick={copy}
              className="mt-2.5 w-full rounded-[10px] bg-[var(--lime)] px-3 py-2 text-[12.5px] font-bold text-[#0a0b0d] transition-opacity"
            >
              {copied ? tr("onboarding.copied") : tr("onboarding.copyBriefing")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
