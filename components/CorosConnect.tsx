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
import { CorosPush, type PushCandidate } from "@/components/CorosPush";

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
  pushCandidates = null,
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
  /** Planned sessions that could go to the watch; null hides the section
   * (e.g. add-device-pushes.sql not run yet). */
  pushCandidates?: PushCandidate[] | null;
}) {
  const tr = translator(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [region, setRegion] = useState<Region>(linkedRegion ?? "eu");

  // The "import a period" window. `today` is filled after mount: the athlete's
  // own calendar day can't be known on the server, and rendering it there would
  // mismatch on hydration around midnight.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [today, setToday] = useState("");
  useEffect(() => setToday(new Date().toLocaleDateString("sv")), []);

  async function sync(range?: { from: string; to: string }) {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/app/coros/sync", {
        method: "POST",
        ...(range ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(range) } : {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setResult(
          json.code === "needs_reconnect"
            ? tr("coros.reconnect")
            : json.code === "bad_range"
              ? tr("coros.range.invalid")
              : `${tr("device.failed")} ${json.error ?? res.status}`,
        );
      } else {
        const n = (json.matched ?? 0) + (json.created ?? 0) + (json.updated ?? 0);
        const fetched = Number(json.fetched ?? 0);
        const sports: (number | string)[] = Array.isArray(json.otherSports) ? json.otherSports : [];
        const win = json.window as { from?: string; to?: string } | undefined;
        // "Nothing new" used to cover three different situations. They are now
        // told apart, because only one of them means "COROS has nothing":
        let base: string;
        if (n) base = `${n} ${tr("device.done")}`;
        else if (fetched > 0) {
          // COROS answered, with activities this product does not import.
          base = `${tr("coros.result.returned")} ${fetched} ${tr("coros.result.notImportable")}` +
            (sports.length ? ` (${tr("coros.result.codes")}: ${sports.join(", ")})` : "");
        } else if (range && win?.from && win?.to) {
          // An explicit period that came back empty: say which one was asked.
          base = `${tr("coros.result.emptyIn")} ${win.from} → ${win.to}`;
        } else base = tr("device.none");
        // Nothing found: show what COROS actually said, so "empty" can be told
        // from "answered in a form this app could not read".
        if (!n && typeof json.note === "string" && json.note) {
          base += ` — ${tr("coros.result.said")}: ${json.note}`;
        }
        // A full page may have been cut short: say so rather than let a long
        // period look complete.
        let text = json.maybeTruncated ? `${base} ${tr("coros.range.full")}` : base;
        // The reply said it held more than this app could read.
        if (typeof json.declared === "number" && json.declared > fetched) {
          text += ` ${tr("coros.result.partial")} (${fetched}/${json.declared})`;
        }
        setResult(text);
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
            onClick={() => void sync()}
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

      {connected && pushCandidates && <CorosPush candidates={pushCandidates} locale={locale} />}

      {/* History the recent window never reaches. Collapsed: it is an
          occasional action, and the card is already the busiest in the panel. */}
      {connected && (
        <details className="w-full">
          <summary className="cursor-pointer text-[11.5px] font-semibold text-[var(--text-muted)]">
            {tr("coros.range.title")}
          </summary>
          <p className="mt-1.5 text-[10.5px] text-[var(--text-faint)]">{tr("coros.range.hint")}</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[10.5px] text-[var(--text-faint)]">
              {tr("coros.range.from")}
              <input
                type="date"
                value={from}
                max={today || undefined}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] text-[var(--text)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10.5px] text-[var(--text-faint)]">
              {tr("coros.range.to")}
              <input
                type="date"
                value={to}
                max={today || undefined}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] text-[var(--text)]"
              />
            </label>
            <button
              onClick={() => void sync({ from, to })}
              disabled={busy || !from || !to}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-[5px] text-[11.5px] font-semibold text-[var(--text)] disabled:opacity-50"
            >
              {busy ? tr("device.syncing") : tr("coros.range.go")}
            </button>
          </div>
        </details>
      )}
    </div>
  );
}
