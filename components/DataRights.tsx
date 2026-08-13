"use client";

// Levar os dados embora, e apagar a conta.
//
// Fica dentro das configurações do atleta e não numa página escondida de
// "privacidade": um direito que só existe se a pessoa souber procurar não é um
// direito muito acessível. O produto guarda HRV, sono, dor, lesão e ciclo
// menstrual — categoria especial no RGPD —, então estes dois botões não são
// cortesia.
import { useState } from "react";
import { translator, type Locale } from "@/lib/i18n";

export function DataRights({ locale }: { locale: Locale }) {
  const tr = translator(locale);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/app/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res || !body?.ok) {
      setErr(body?.code === "confirm_mismatch" ? tr("data.mismatch") : tr("data.failed"));
      setBusy(false);
      return;
    }
    // A conta deixou de existir; qualquer navegação para dentro daria erro.
    window.location.href = "/";
  }

  return (
    <div className="border-t border-[var(--border)] px-5 py-4">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
        {tr("data.title")}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href="/api/app/export"
          download
          className="rounded-[10px] border border-[var(--border)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--text)] transition-colors hover:border-[var(--text)]"
        >
          {tr("data.export")}
        </a>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-[10px] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--bad)] hover:underline"
        >
          {tr("data.delete")}
        </button>
      </div>
      <p className="mt-1.5 text-[11.5px] text-[var(--text-faint)]">{tr("data.exportHint")}</p>

      {open && (
        <div className="mt-3 rounded-[10px] border border-[var(--bad)] p-3">
          <p className="text-[12.5px] font-semibold text-[var(--text)]">{tr("data.sure")}</p>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">{tr("data.sureSub")}</p>
          {/* Digitar o e-mail, não um "sim": a chave é a única credencial, então
              quem chega aqui já tem acesso total — a única proteção que ainda
              faz sentido é contra o próprio clique errado. */}
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={tr("data.typeEmail")}
            className="mt-2 w-full rounded-[9px] border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--bad)]"
          />
          {err && <p className="mt-1.5 text-[12px] text-[var(--bad)]">{err}</p>}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={remove}
              disabled={busy || confirm.trim().length === 0}
              className="rounded-[9px] bg-[var(--bad)] px-3 py-1.5 text-[12.5px] font-bold text-[#0a0b0d] disabled:opacity-40"
            >
              {tr("data.deleteForever")}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setConfirm(""); setErr(null); }}
              className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              {tr("data.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
