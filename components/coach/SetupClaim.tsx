"use client";

// Confirmar a assessoria e receber a chave — a chave aparece UMA vez.
//
// Mesmo tratamento que a chave do atleta recebe em /coach/athletes, e pelo mesmo
// motivo: só o hash é gravado, então esta tela é a única oportunidade de copiá-la.
// Por isso ela não some sozinha, não tem "continuar" antes de o dono confirmar
// que guardou, e o aviso é explícito em vez de sutil.
import { useState } from "react";
import { translator, type Locale } from "@/lib/i18n";

export function SetupClaim({
  token, agencyName, ownerName, locale,
}: { token: string; agencyName: string; ownerName: string | null; locale: Locale }) {
  const tr = translator(locale);
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function claim() {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/coach/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res || !body?.ok) {
      setErr(tr("setup.failed"));
      setBusy(false);
      return;
    }
    setKey(body.key as string);
    setBusy(false);
  }

  if (key) {
    return (
      <div className="rounded-[16px] border border-[var(--lime)] bg-[var(--surface)] p-6">
        <h1 className="dsp text-[20px] font-extrabold text-[var(--text)]">{tr("setup.done")}</h1>
        <p className="mt-1.5 text-[13.5px] text-[var(--text-muted)]">{tr("setup.keyOnce")}</p>

        <div className="mt-4 flex items-center gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2.5">
          <code className="min-w-0 flex-1 break-all font-mono text-[12.5px] text-[var(--text)]">{key}</code>
          <button
            type="button"
            onClick={() => { navigator.clipboard.writeText(key); setCopied(true); }}
            className="shrink-0 rounded-[9px] bg-[var(--lime)] px-3 py-1.5 text-[12px] font-bold text-[#0a0b0d]"
          >
            {copied ? tr("setup.copied") : tr("setup.copy")}
          </button>
        </div>

        <ol className="mt-5 flex list-decimal flex-col gap-1.5 pl-4 text-[13px] text-[var(--text-muted)]">
          <li>{tr("setup.step1")}</li>
          <li>{tr("setup.step2")}</li>
          <li>{tr("setup.step3")}</li>
        </ol>

        {/* Só libera a entrada depois de copiar: sair desta tela sem a chave
            significa precisar de uma nova, e o dono não tem como saber disso. */}
        <a
          href="/coach/login"
          className={`mt-5 inline-block rounded-[10px] px-4 py-2 text-[13px] font-bold transition-opacity ${
            copied ? "bg-[var(--lime)] text-[#0a0b0d]" : "pointer-events-none bg-[var(--surface-3)] text-[var(--text-faint)]"
          }`}
        >
          {tr("setup.goLogin")}
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-[16px] border border-[var(--border-soft)] bg-[var(--surface)] p-6">
      <h1 className="dsp text-[20px] font-extrabold text-[var(--text)]">{tr("setup.welcome")}</h1>
      <p className="mt-1.5 text-[13.5px] text-[var(--text-muted)]">
        {tr("setup.about").replace("{agency}", agencyName)}
      </p>
      {ownerName && <p className="mt-1 text-[13px] text-[var(--text-faint)]">{ownerName}</p>}
      {err && <p className="mt-3 text-[12.5px] text-[var(--bad)]">{err}</p>}
      <button
        type="button"
        onClick={claim}
        disabled={busy}
        className="mt-5 rounded-[10px] bg-[var(--lime)] px-4 py-2 text-[13px] font-bold text-[#0a0b0d] disabled:opacity-40"
      >
        {tr("setup.create")}
      </button>
      <p className="mt-2 text-[11.5px] text-[var(--text-faint)]">{tr("setup.onceHint")}</p>
    </div>
  );
}
