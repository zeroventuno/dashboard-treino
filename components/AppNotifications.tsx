"use client";

import { useEffect, useRef, useState } from "react";
import { translator, type Locale } from "@/lib/i18n";
import { Icon } from "@/components/coach/icons";

/** One notice in the bell. `version` is compared to the athlete's last-seen
 * value (localStorage `seenKey`) to decide whether it's new; `action`, if
 * present, renders a button (e.g. copy the briefing). */
type NoticeDef = {
  id: string;
  version: number;
  seenKey: string;
  title: string;
  body: string;
  action?: { idle: string; done: string; run: () => Promise<void> | void };
};

/** Athlete-side notifications bell in the /app top bar. Carries version-tracked
 * notices — a new briefing to re-paste, a connector to re-add when the tool set
 * changes — and is the home for future alerts. The "new" dot shows until the
 * athlete opens the panel (opening acknowledges everything). */
export function AppNotifications({
  briefing,
  briefingVersion,
  connectorVersion,
  locale,
}: {
  briefing: string;
  briefingVersion: number;
  connectorVersion: number;
  locale: Locale;
}) {
  const tr = translator(locale);
  const [open, setOpen] = useState(false);
  // seen[id] is undefined until the mount effect reads localStorage — so nothing
  // reads as "new" during SSR / first paint, only once we know the stored value.
  const [seen, setSeen] = useState<Record<string, number>>({});
  const [done, setDone] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const notices: NoticeDef[] = [
    {
      id: "briefing",
      version: briefingVersion,
      seenKey: "trak_briefing_seen",
      title: tr("app.notif.briefing.title"),
      body: tr("app.notif.briefing.body"),
      action: {
        idle: tr("onboarding.copyBriefing"),
        done: tr("onboarding.copied"),
        run: () => navigator.clipboard.writeText(briefing),
      },
    },
    {
      id: "connector",
      version: connectorVersion,
      seenKey: "trak_connector_seen",
      title: tr("app.notif.connector.title"),
      body: tr("app.notif.connector.body"),
    },
  ];

  useEffect(() => {
    const s: Record<string, number> = {};
    for (const n of notices) s[n.id] = Number(localStorage.getItem(n.seenKey) ?? 0);
    setSeen(s);
    // notices is derived from props each render; reading it once on mount is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const anyNew = notices.some((n) => n.id in seen && n.version > seen[n.id]);

  function markAllSeen() {
    const s = { ...seen };
    for (const n of notices) {
      localStorage.setItem(n.seenKey, String(n.version));
      s[n.id] = n.version;
    }
    setSeen(s);
  }

  function toggle() {
    setOpen((o) => {
      if (!o) markAllSeen(); // opening = acknowledging
      return !o;
    });
  }

  async function runAction(n: NoticeDef) {
    if (!n.action) return;
    try {
      await n.action.run();
      setDone(n.id);
      setTimeout(() => setDone((d) => (d === n.id ? null : d)), 2000);
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
        {anyNew && (
          <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-[var(--bad)] ring-2 ring-[rgba(38,43,52,1)]" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[320px] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow)]">
          <p className="px-1 text-[11px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
            {tr("app.notif.title")}
          </p>

          <div className="mt-2 space-y-2">
            {notices.map((n) => (
              <div key={n.id} className="rounded-[12px] border border-[var(--border-soft)] bg-[var(--surface-2)] p-3">
                <p className="text-[12.5px] font-semibold text-[var(--text)]">{n.title}</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--text-muted)]">{n.body}</p>
                {n.action && (
                  <button
                    type="button"
                    onClick={() => runAction(n)}
                    className="mt-2.5 w-full rounded-[10px] bg-[var(--lime)] px-3 py-2 text-[12.5px] font-bold text-[#0a0b0d] transition-opacity"
                  >
                    {done === n.id ? n.action.done : n.action.idle}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
