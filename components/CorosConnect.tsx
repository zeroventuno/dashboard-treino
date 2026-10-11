"use client";

// "Connect my COROS" — lives inside the athlete's settings, next to the other
// ways data gets in.
//
// Never receives tokens: the page hands over status only. There is no COROS
// brand artwork here on purpose — COROS's terms reserve its marks, and the
// name in plain text is all this needs.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { translator, type Locale, type TKey } from "@/lib/i18n";

/** What COROS's redirect (or our own gate) can tell us, mapped to copy. */
const NOTICE: Record<string, TKey> = {
  connected: "coros.notice.connected",
  cancelled: "coros.notice.cancelled",
  bad_state: "coros.notice.badState",
  failed: "coros.notice.failed",
  agency_blocked: "coros.agency",
  needs_migration: "coros.unavailable",
};

type Region = "eu" | "us";

export function CorosConnect({
  mode,
  connected,
  region: linkedRegion,
  lastSyncAt,
  lastError,
  locale,
  notice,
}: {
  /** `agency`: this athlete has a coach reading their calendar — not cleared.
   * `unavailable`: the deploy hasn't had its migration yet. */
  mode: "ready" | "agency" | "unavailable";
  connected: boolean;
  region: Region | null;
  lastSyncAt: string | null;
  lastError: string | null;
  locale: Locale;
  notice?: string;
}) {
  const tr = translator(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [region, setRegion] = useState<Region>(linkedRegion ?? "eu");

  async function sync() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/app/coros/sync", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setResult(
          json.code === "needs_reconnect"
            ? tr("coros.reconnect")
            : `${tr("device.failed")} ${json.error ?? res.status}`,
        );
      } else {
        const n = (json.matched ?? 0) + (json.created ?? 0) + (json.updated ?? 0);
        setResult(n ? `${n} ${tr("device.done")}` : tr("device.none"));
        // New sessions have to reach the calendar, not just this label.
        router.refresh();
      }
    } catch {
      setResult(tr("device.error"));
    } finally {
      setBusy(false);
    }
  }

  // Right after the athlete authorises there is nothing to look at until a
  // sync runs, and waiting for them to find the button reads as "it didn't
  // work". Once, and only on the redirect that says they just connected.
  const autoSynced = useRef(false);
  useEffect(() => {
    if (notice === "connected" && connected && !autoSynced.current) {
      autoSynced.current = true;
      void sync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice, connected]);

  async function disconnect() {
    if (!confirm(tr("coros.disconnectAsk"))) return;
    setBusy(true);
    await fetch("/api/app/coros/disconnect", { method: "POST" });
    setBusy(false);
    router.refresh();
  }

  const noticeKey = notice ? NOTICE[notice] : undefined;
  const shell = "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border border-[var(--border-soft)] bg-[var(--surface-2)] px-3.5 py-2.5";

  if (mode !== "ready") {
    return (
      <div className={shell}>
        <span className="shrink-0 text-[12.5px] font-semibold text-[var(--text)]">{tr("coros.title")}</span>
        <span className="min-w-0 flex-1 text-[11.5px] text-[var(--text-faint)]">
          {tr(mode === "agency" ? "coros.agency" : "coros.unavailable")}
        </span>
      </div>
    );
  }

  return (
    <div className={shell}>
      <span className="shrink-0 text-[12.5px] font-semibold text-[var(--text)]">
        {connected ? tr("coros.connected") : tr("coros.title")}
      </span>

      <span className="min-w-0 flex-1 text-[11.5px] text-[var(--text-faint)]">
        {connected
          ? lastSyncAt
            ? `${tr("device.synced")} ${new Date(lastSyncAt).toLocaleString(locale, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
            : tr("device.never")
          : tr("coros.hint")}
      </span>

      {connected ? (
        <span className="flex items-center gap-2">
          <button
            onClick={sync}
            disabled={busy}
            className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-[5px] text-[11.5px] font-semibold text-[var(--text)] disabled:opacity-50"
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
        <span className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-faint)]">
            <span className="sr-only">{tr("coros.region")}</span>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value as Region)}
              aria-label={tr("coros.region")}
              title={tr("coros.regionHint")}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-[5px] text-[11.5px] text-[var(--text)]"
            >
              <option value="eu">{tr("coros.region.eu")}</option>
              <option value="us">{tr("coros.region.us")}</option>
            </select>
          </label>
          {/* A plain link, not fetch(): the connect route is a redirect to COROS. */}
          <a
            href={`/api/app/coros/connect?region=${region}`}
            className="rounded-full bg-[var(--lime)] px-3.5 py-[5px] text-[11.5px] font-bold text-[#0a0b0d] transition-opacity hover:opacity-90"
          >
            {tr("coros.connect")}
          </a>
        </span>
      )}

      {(lastError || result || noticeKey) && (
        <p className="w-full break-words text-[11.5px] text-[var(--text-muted)]">
          {lastError && !result && <span style={{ color: "var(--bad)" }}>{tr("device.failed")} {lastError}</span>}
          {result}
          {!lastError && !result && noticeKey && tr(noticeKey)}
        </p>
      )}
      {!connected && <p className="w-full text-[10.5px] text-[var(--text-faint)]">{tr("coros.regionHint")}</p>}
    </div>
  );
}
