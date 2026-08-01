"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { translator, type Locale, type TKey } from "@/lib/i18n";

const ROLES = ["coach", "nutritionist", "physio"] as const;

export function AddProfessional({ locale }: { locale: Locale }) {
  const tr = translator(locale);
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("coach");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/coach/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setError(tr("coach.settings.createError"));
        return;
      }
      setNewKey(body.key);
      setName("");
      setEmail("");
      router.refresh(); // pull the new person into the list
    } catch {
      setError(tr("coach.settings.createError"));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard refused — the key is visible to select manually */
    }
  }

  const field =
    "w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-[13px] text-[var(--text)] outline-none transition-colors focus:border-[var(--lime)]";

  return (
    <div className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] p-5">
      <h2 className="text-[14px] font-bold text-[var(--text)]">{tr("coach.settings.add")}</h2>

      <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2.5">
        <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-[11.5px] text-[var(--text-faint)]">
          {tr("coach.settings.name")}
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-[11.5px] text-[var(--text-faint)]">
          {tr("coach.settings.email")}
          <input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[11.5px] text-[var(--text-faint)]">
          {tr("coach.settings.role")}
          <select className={field} value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {tr(`coach.role.${r}` as TKey)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-[10px] bg-[var(--lime)] px-4 py-2 text-[13px] font-bold text-[#0a0b0d] transition-opacity disabled:opacity-40"
        >
          {tr("coach.settings.create")}
        </button>
      </form>

      {error && <p className="mt-2.5 text-[12px] text-[var(--bad)]">{error}</p>}

      {newKey && (
        <div className="mt-4 rounded-[12px] border border-[var(--lime)]/50 bg-[var(--surface-2)] p-3.5">
          <p className="text-[12px] font-semibold text-[var(--text)]">{tr("coach.settings.keyTitle")}</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-[var(--warn)]">{tr("coach.settings.keyOnce")}</p>
          <div className="mt-2 flex items-stretch gap-2">
            <code className="min-w-0 flex-1 select-all break-all rounded-[8px] border border-[var(--border)] bg-[var(--bg-soft)] px-2.5 py-2 font-mono text-[11.5px] text-[var(--text-muted)]">
              {newKey}
            </code>
            <button
              type="button"
              onClick={copy}
              className="shrink-0 rounded-[8px] border border-[var(--lime)] bg-[var(--lime)] px-3 text-[11.5px] font-bold text-[#0a0b0d]"
            >
              {copied ? tr("onboarding.copied") : tr("onboarding.copy")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
