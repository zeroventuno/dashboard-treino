"use client";

// Onde a conta do atleta nasce — e onde ele conecta a IA dele.
//
// Este é o maior risco de conversão do produto inteiro: alguém que acabou de
// pagar precisa colar três coisas na própria IA. Se desistir aqui, pagou e não
// usou. Por isso os passos vivem NESTA tela, cada um com botão de copiar, em
// vez de num e-mail ou numa página de ajuda que ele teria que ir procurar.
import { useState } from "react";
import { translator, type Locale } from "@/lib/i18n";
import { coachBriefing } from "@/lib/coach-briefing";

function CopyRow({ label, value, cta, done }: { label: string; value: string; cta: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">{label}</p>
      <div className="flex items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--text)]">{value}</code>
        <button
          type="button"
          onClick={() => { navigator.clipboard.writeText(value); setCopied(true); }}
          className="shrink-0 rounded-[8px] bg-[var(--lime)] px-2.5 py-1 text-[11.5px] font-bold text-[#0a0b0d]"
        >
          {copied ? done : cta}
        </button>
      </div>
    </div>
  );
}

export function AthleteClaim({
  token, kind, email, name, locale, connectorUrl,
}: {
  token: string;
  kind: "signup" | "recover";
  email: string;
  name: string | null;
  locale: Locale;
  connectorUrl: string;
}) {
  const tr = translator(locale);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function claim() {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/app/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res || !body?.ok) {
      setErr(body?.code === "duplicate_email" ? tr("claim.already") : tr("claim.failed"));
      setBusy(false);
      return;
    }
    setKey(body.key as string);
    setBusy(false);
  }

  if (key) {
    return (
      <div className="rounded-[16px] border border-[var(--lime)] bg-[var(--surface)] p-5 sm:p-6">
        <h1 className="dsp text-[21px] font-extrabold text-[var(--text)]">
          {kind === "recover" ? tr("claim.rotated") : tr("claim.created")}
        </h1>
        <p className="mt-1.5 text-[13.5px] text-[var(--text-muted)]">{tr("claim.keyOnce")}</p>

        <div className="mt-4 flex flex-col gap-3">
          <CopyRow label={tr("claim.yourKey")} value={key} cta={tr("claim.copy")} done={tr("claim.copied")} />
        </div>

        <label className="mt-3 flex cursor-pointer items-start gap-2 text-[12.5px] text-[var(--text-muted)]">
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            className="mt-[3px] h-[15px] w-[15px] shrink-0 accent-[var(--lime)]"
          />
          {tr("claim.confirmSaved")}
        </label>

        {/* Os passos ficam AQUI, não num e-mail: é o momento em que a pessoa
            está com a chave na mão e disposta a terminar. */}
        <div className={`mt-5 border-t border-[var(--border-soft)] pt-5 ${saved ? "" : "pointer-events-none opacity-40"}`}>
          <h2 className="text-[15px] font-bold text-[var(--text)]">{tr("claim.connect")}</h2>
          <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">{tr("claim.connectSub")}</p>

          <ol className="mt-3 flex flex-col gap-3">
            <li>
              <CopyRow label={tr("claim.step1")} value={connectorUrl} cta={tr("claim.copy")} done={tr("claim.copied")} />
            </li>
            <li>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">
                {tr("claim.step2")}
              </p>
              <p className="text-[12.5px] text-[var(--text-muted)]">{tr("claim.step2Sub")}</p>
            </li>
            <li>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">
                {tr("claim.step3")}
              </p>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(coachBriefing(locale))}
                className="rounded-[9px] border border-[var(--border)] px-3 py-1.5 text-[12px] font-semibold text-[var(--text)] hover:border-[var(--text)]"
              >
                {tr("claim.copyBriefing")}
              </button>
              <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">{tr("claim.step3Sub")}</p>
            </li>
          </ol>

          <a
            href="/app"
            className="mt-5 inline-block rounded-[10px] bg-[var(--lime)] px-4 py-2 text-[13px] font-bold text-[#0a0b0d]"
          >
            {tr("claim.openPanel")}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[16px] border border-[var(--border-soft)] bg-[var(--surface)] p-5 sm:p-6">
      <h1 className="dsp text-[21px] font-extrabold text-[var(--text)]">
        {kind === "recover" ? tr("claim.recoverTitle") : tr("claim.welcome")}
      </h1>
      <p className="mt-1.5 text-[13.5px] text-[var(--text-muted)]">
        {kind === "recover" ? tr("claim.recoverSub") : tr("claim.welcomeSub")}
      </p>
      <p className="mt-1 text-[13px] text-[var(--text-faint)]">{name ? `${name} · ${email}` : email}</p>
      {err && <p className="mt-3 text-[12.5px] text-[var(--bad)]">{err}</p>}
      <button
        type="button"
        onClick={claim}
        disabled={busy}
        className="mt-5 rounded-[10px] bg-[var(--lime)] px-4 py-2 text-[13px] font-bold text-[#0a0b0d] disabled:opacity-40"
      >
        {kind === "recover" ? tr("claim.rotate") : tr("claim.create")}
      </button>
      <p className="mt-2 text-[11.5px] text-[var(--text-faint)]">
        {kind === "recover" ? tr("claim.rotateHint") : tr("claim.onceHint")}
      </p>
    </div>
  );
}
