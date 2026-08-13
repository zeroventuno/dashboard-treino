"use client";

// Formulário público de recuperação de chave.
//
// A tela diz a MESMA coisa exista o e-mail ou não — "se houver conta, o link
// foi enviado". Um formulário aberto que responde diferente para endereço
// cadastrado é um verificador de quem usa o produto, e aqui a lista de usuários
// é uma lista de pessoas com dados de saúde no sistema.
import { useState } from "react";
import { translator, type Locale } from "@/lib/i18n";

export function RecoverForm({ locale }: { locale: Locale }) {
  const tr = translator(locale);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "unavailable">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    const res = await fetch("/api/app/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    // 503 é a única resposta que muda a tela, e ela não distingue e-mail nenhum:
    // significa que o envio está fora do ar para todo mundo.
    setState(res?.status === 503 ? "unavailable" : "sent");
  }

  if (state === "sent") {
    return (
      <p className="mt-4 rounded-[10px] border border-[var(--lime)] px-3 py-3 text-[13px] text-[var(--text-muted)]">
        {tr("recover.sent")}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-2">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={tr("recover.email")}
        className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-[13px] text-[var(--text)] outline-none focus:border-[var(--lime)]"
      />
      <button
        type="submit"
        disabled={state === "busy"}
        className="rounded-[10px] bg-[var(--lime)] px-4 py-2 text-[13px] font-bold text-[#0a0b0d] disabled:opacity-40"
      >
        {tr("recover.send")}
      </button>
      {state === "unavailable" && (
        <p className="text-[12px] text-[var(--bad)]">{tr("recover.unavailable")}</p>
      )}
      <p className="mt-1 text-[11.5px] text-[var(--text-faint)]">{tr("recover.warn")}</p>
    </form>
  );
}
