"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { translator, type Locale } from "@/lib/i18n";

// `mailed` says whether the welcome e-mail actually went out. Kept separate
// from success on purpose: the account exists either way, and telling the
// owner it was sent when it was not is how an athlete waits for nothing.
type Created = { key: string; name: string; email: string; mailed: boolean };

/**
 * Register an athlete and hand over their onboarding.
 *
 * The account key is shown exactly once — only its hash is stored, so a reload
 * cannot bring it back. That's why the panel doesn't just flash a toast: it
 * keeps the block on screen with a copy button and the ready-to-send message,
 * until the owner explicitly dismisses it.
 */
export function AddAthlete({ locale, appUrl, mcpUrl }: { locale: Locale; appUrl: string; mcpUrl: string }) {
  const tr = translator(locale);
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", nickname: "", phone: "" });
  const [state, setState] = useState<"idle" | "saving" | "error" | "duplicate">("idle");
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState<"key" | "message" | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    if (!form.name.trim() || !form.email.trim()) return;
    setState("saving");
    try {
      const res = await fetch("/api/coach/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "newAthlete", ...form }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setState(data.code === "duplicate_email" ? "duplicate" : "error");
        return;
      }
      setCreated({ key: data.key, name: form.name, email: form.email, mailed: data.mailed === true });
      setForm({ name: "", email: "", nickname: "", phone: "" });
      setState("idle");
      // router.refresh() moved to dismiss(), on purpose: this screen shows a
      // secret that cannot ever be shown again, so nothing may re-render it
      // out from under the owner while it is up. A background refresh here
      // was the prime suspect for the key vanishing after ~1s — Next.js says
      // a refresh preserves client state, and this codebase has learned today,
      // three times over, not to trust a claim like that over what actually
      // happens. Refreshing only on dismiss removes the risk outright instead
      // of trying to prove which theory was right.
    } catch {
      setState("error");
    }
  }

  const message = created
    ? [
        tr("athletes.msgHello").replace("{name}", created.name),
        "",
        tr("athletes.msgStep1"),
        `${appUrl}?key=${created.key}`,
        "",
        tr("athletes.msgStep2"),
        `${mcpUrl}?key=${created.key}`,
        "",
        tr("athletes.msgStep3"),
      ].join("\n")
    : "";

  async function copy(what: "key" | "message") {
    try {
      await navigator.clipboard.writeText(what === "key" ? created!.key : message);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard refused — the text is on screen to select */
    }
  }

  return (
    <section className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] p-5">
      <h2 className="text-[14px] font-bold text-[var(--text)]">{tr("athletes.add")}</h2>
      <p className="mt-0.5 text-[12.5px] text-[var(--text-faint)]">{tr("athletes.addHint")}</p>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={tr("athletes.name")} value={form.name} onChange={set("name")} required />
        <Field label={tr("athletes.email")} value={form.email} onChange={set("email")} type="email" required />
        <Field label={tr("athletes.nickname")} value={form.nickname} onChange={set("nickname")} />
        <Field label={tr("athletes.phone")} value={form.phone} onChange={set("phone")} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={state === "saving" || !form.name.trim() || !form.email.trim()}
          className="rounded-[10px] bg-[var(--lime)] px-4 py-2 text-[13px] font-bold text-[#0a0b0d] transition-opacity disabled:opacity-40"
        >
          {state === "saving" ? "…" : tr("athletes.create")}
        </button>
        {state === "duplicate" && <span className="text-[12px] text-[var(--warn)]">{tr("athletes.duplicate")}</span>}
        {state === "error" && <span className="text-[12px] text-[var(--bad)]">{tr("admin.saveError")}</span>}
      </div>

      {created && (
        <div className="mt-4 rounded-[12px] border border-[var(--lime)]/50 bg-[var(--surface-2)] p-4">
          <p className="text-[13px] font-bold text-[var(--lime)]">
            {tr("athletes.created").replace("{name}", created.name)}
          </p>
          <p className="mt-1 text-[12px] text-[var(--warn)]">{tr("athletes.keyOnce")}</p>

          {/* Whether the e-mail actually left. Said plainly either way: "sent"
              when it was, and an explicit "not sent — send it yourself" when it
              wasn't, because an owner who assumes it went out leaves the athlete
              waiting for a message that will never arrive. */}
          <p className={`mt-1 text-[12px] ${created.mailed ? "text-[var(--good)]" : "text-[var(--text-muted)]"}`}>
            {created.mailed
              ? tr("athletes.mailSent").replace("{email}", created.email)
              : tr("athletes.mailNotSent")}
          </p>

          <code className="mt-2 block overflow-x-auto rounded-[8px] bg-[var(--bg-soft)] px-3 py-2 font-mono text-[12px] text-[var(--text)]">
            {created.key}
          </code>

          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => copy("message")}
              className="rounded-[10px] bg-[var(--lime)] px-3 py-1.5 text-[12.5px] font-bold text-[#0a0b0d]"
            >
              {copied === "message" ? tr("onboarding.copied") : tr("athletes.copyMessage")}
            </button>
            <button
              type="button"
              onClick={() => copy("key")}
              className="rounded-[10px] border border-[var(--border)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--text-muted)]"
            >
              {copied === "key" ? tr("onboarding.copied") : tr("athletes.copyKey")}
            </button>
            <button
              type="button"
              onClick={() => { setCreated(null); router.refresh(); }}
              className="rounded-[10px] px-3 py-1.5 text-[12.5px] font-medium text-[var(--text-faint)] underline"
            >
              {tr("athletes.dismiss")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({
  label, value, onChange, type = "text", required = false,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
        {label}
        {required && <span className="text-[var(--lime)]"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--lime)]"
      />
    </label>
  );
}
