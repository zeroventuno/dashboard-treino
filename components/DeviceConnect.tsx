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

/** Strava's brand orange, used only for the connected dot — never to build a
 * button that imitates theirs. */
const STRAVA = "#FC5200";

/** The official "Connect with Strava" artwork, at its native 474×96 ratio.
 *
 * This replaced a lookalike button — orange background, our own type — which
 * the brand guidelines prohibit: the connect button must be their supplied
 * asset, unmodified and unstretched, and nothing may suggest the app is an
 * official Strava product. Cosmetic while this serves ten athletes, and a
 * rejection at the Extended Access review that the agency tier needs. */
const CONNECT_BUTTON = { src: "/strava/connect-orange.svg", w: 474, h: 96 };

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

  // Working and quiet: no card, no border, just a line of small print above the
  // blocks. It can't disappear entirely yet — this is still the ONLY thing that
  // triggers a sync, so hiding it would mean nothing ever imports. Once the
  // scheduled sync lands, the healthy state has nothing left to offer and the
  // row can go for good.
  const quiet = connected && !lastError;

  return (
    <div
      className={`mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 ${
        quiet ? "px-1 py-0.5" : "rounded-[14px] border bg-[var(--surface)] px-3.5 py-2.5"
      }`}
      style={
        quiet
          ? undefined
          : {
              borderColor: lastError
                ? "color-mix(in oklab, var(--bad) 45%, transparent)"
                : "color-mix(in oklab, var(--warn) 35%, transparent)",
            }
      }
    >
      <span
        className={`shrink-0 rounded-full ${quiet ? "h-1.5 w-1.5" : "h-2 w-2"}`}
        style={{ background: quiet ? STRAVA : "var(--text-faint)" }}
      />

      <span
        className={
          quiet
            ? "text-[11px] text-[var(--text-faint)]"
            : "text-[12.5px] font-semibold text-[var(--text)]"
        }
      >
        {connected ? tr("device.connected") : tr("device.title")}
      </span>

      <span className={`min-w-0 flex-1 text-[var(--text-faint)] ${quiet ? "text-[11px]" : "text-[11.5px]"}`}>
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
            className={
              quiet
                ? "text-[11px] font-medium text-[var(--text-muted)] underline underline-offset-2 disabled:opacity-50"
                : "rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-[5px] text-[11.5px] font-semibold text-[var(--text)] disabled:opacity-50"
            }
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
          {/* Required attribution, and only rendered once connected — before
              that no Strava data is on screen and there is nothing to credit.
              Kept smaller and quieter than our own brand, which the guidelines
              ask for explicitly. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/strava/compatible-white.svg"
            alt="Compatible with Strava"
            width={437}
            height={37}
            className="ml-1 block h-[13px] w-auto opacity-40"
          />
        </span>
      ) : (
        // A plain link, not fetch(): the connect route is a redirect to strava.com.
        // The image carries the words "Connect with Strava" itself, so the link's
        // accessible name comes from alt text rather than a visible label that
        // would repeat it.
        <a href="/api/app/strava/connect" className="shrink-0 transition-opacity hover:opacity-85">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={CONNECT_BUTTON.src}
            alt={tr("device.connect")}
            width={CONNECT_BUTTON.w}
            height={CONNECT_BUTTON.h}
            // Height-only sizing keeps the supplied ratio exactly. Stretching or
            // recolouring their artwork is what the guidelines forbid.
            className="block h-[30px] w-auto"
          />
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
