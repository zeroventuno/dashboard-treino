"use client";

// "Connect my watch" — one line on the athlete's dashboard.
//
// Deliberately not a dashboard block: it isn't a training metric, it's plumbing.
// Once connected it collapses to a single quiet row, because a working
// integration should get out of the way; the loud state is the one that needs a
// decision (not connected, or the last sync failed).
//
// Never receives the tokens — the page hands over status only.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { translator, type Locale, type TKey } from "@/lib/i18n";

/** Strava's brand orange. Their guidelines require the button to be recognisably
 * theirs, and an athlete scanning the page finds it by colour before text. */
const STRAVA = "#FC4C02";

/** What the OAuth callback can tell us on the way back, mapped to copy. Written
 * out rather than templated so a missing translation is a build error, which is
 * the whole point of the typed dictionary. */
const NOTICE: Record<string, TKey> = {
  cancelled: "device.notice.cancelled",
  bad_state: "device.notice.badState",
  failed: "device.notice.failed",
  not_configured: "device.notice.notConfigured",
};

export function DeviceConnect({
  connected,
  lastSyncAt,
  lastError,
  locale,
  notice,
}: {
  connected: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  locale: Locale;
  notice?: string;
}) {
  const tr = translator(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/app/strava/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setResult(`${tr("device.failed")} ${json.error ?? res.status}`);
      } else {
        const n = (json.matched ?? 0) + (json.created ?? 0) + (json.updated ?? 0);
        setResult(n ? `${n} ${tr("device.done")}` : tr("device.none"));
        // New sessions have to appear on the calendar, not just in this label.
        router.refresh();
      }
    } catch {
      setResult(tr("device.error"));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm(tr("device.disconnectAsk"))) return;
    setBusy(true);
    await fetch("/api/app/strava/disconnect", { method: "POST" });
    setBusy(false);
    router.refresh();
  }

  // A failed sync is worth interrupting for; a healthy one is not.
  const alarm = !connected || !!lastError;
  const noticeKey = notice ? NOTICE[notice] : undefined;

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border bg-[var(--surface)] px-3.5 py-2.5"
      style={{
        borderColor: lastError
          ? "color-mix(in oklab, var(--bad) 45%, transparent)"
          : alarm
            ? "color-mix(in oklab, var(--warn) 35%, transparent)"
            : "var(--border-soft)",
      }}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: connected && !lastError ? STRAVA : "var(--text-faint)" }} />

      <span className="text-[12.5px] font-semibold text-[var(--text)]">
        {connected ? tr("device.connected") : tr("device.title")}
      </span>

      <span className="min-w-0 flex-1 text-[11.5px] text-[var(--text-faint)]">
        {connected
          ? lastSyncAt
            ? `${tr("device.synced")} ${new Date(lastSyncAt).toLocaleString(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
            : tr("device.never")
          : tr("device.hint")}
      </span>

      {connected ? (
        <span className="flex items-center gap-2">
          <button
            onClick={sync}
            disabled={busy}
            className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-[5px] text-[11.5px] font-semibold text-[var(--text)] disabled:opacity-50"
          >
            {busy ? tr("device.syncing") : tr("device.sync")}
          </button>
          <button
            onClick={disconnect}
            disabled={busy}
            className="text-[11px] text-[var(--text-faint)] underline underline-offset-2 disabled:opacity-50"
          >
            {tr("device.disconnect")}
          </button>
        </span>
      ) : (
        // A plain link, not fetch(): the connect route is a redirect to strava.com.
        <a
          href="/api/app/strava/connect"
          className="rounded-full px-3.5 py-[6px] text-[11.5px] font-bold text-white"
          style={{ background: STRAVA }}
        >
          {tr("device.connect")}
        </a>
      )}

      {(lastError || result || noticeKey) && (
        <p className="w-full text-[11.5px] text-[var(--text-muted)]">
          {lastError && <span style={{ color: "var(--bad)" }}>{tr("device.failed")} {lastError}</span>}
          {!lastError && result}
          {!lastError && !result && noticeKey && tr(noticeKey)}
        </p>
      )}
    </div>
  );
}
