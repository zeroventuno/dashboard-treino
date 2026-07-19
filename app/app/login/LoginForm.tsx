"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { translator, type Locale } from "@/lib/i18n";

/** The account key always starts with this, in every language. */
const KEY_PREFIX = "trak_";

export function LoginForm({ locale }: { locale: Locale }) {
  const tr = translator(locale);
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/app-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? tr("login.error"));
        return;
      }
      router.push("/app");
      router.refresh();
    } catch {
      setError(tr("login.networkError"));
    } finally {
      setBusy(false);
    }
  }

  // The intro sentence carries the key prefix inline; each language puts it in a
  // different place, so the translation owns a {prefix} slot we splice around.
  const [introBefore, introAfter] = tr("login.hint").split("{prefix}");

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-[400px] rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] p-7 shadow-[var(--shadow)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-trak.png" alt="TRAK" className="mb-6 h-[26px] w-auto" />

        <h1 className="dsp text-[22px] font-extrabold text-[var(--text)]">{tr("login.title")}</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-muted)]">
          {introBefore}
          <code className="text-[var(--lime)]">{KEY_PREFIX}</code>
          {introAfter}
        </p>

        <form onSubmit={submit} className="mt-5">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={`${KEY_PREFIX}…`}
            autoComplete="off"
            className="w-full rounded-[12px] border border-[var(--border)] bg-[var(--bg-soft)] px-3.5 py-3 font-mono text-[13px] text-[var(--text)] outline-none transition-colors focus:border-[var(--lime)]"
          />

          {error && (
            <p className="mt-2.5 text-[12.5px] font-medium text-[var(--bad)]">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy || key.trim().length === 0}
            className="mt-4 w-full rounded-[12px] bg-[var(--lime)] px-4 py-3 text-[14px] font-bold text-[#0a0b0d] transition-opacity disabled:opacity-40"
          >
            {busy ? tr("login.submitting") : tr("login.submit")}
          </button>
        </form>

        <p className="mt-5 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
          {tr("login.lost")}
        </p>
      </div>
    </div>
  );
}
