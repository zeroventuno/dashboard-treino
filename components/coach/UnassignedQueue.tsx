"use client";

// A fila de alunos sem treinador, com a sugestão do sistema ao lado.
//
// O sistema propõe, a pessoa confirma. Por isso o botão principal diz o NOME do
// sugerido em vez de "aceitar sugestão": quem clica tem que saber o que está
// escolhendo sem precisar decifrar. E o seletor com todo mundo fica ao lado, no
// mesmo peso visual — discordar não pode ser mais trabalhoso que concordar.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { suggestCoach, bestSuggestion, type Candidate, type ReasonKind } from "@/lib/suggest-coach";
import { translator, type Locale, type TKey } from "@/lib/i18n";

export interface QueueAthlete {
  tenantId: string;
  name: string;
  sports: string[];
  monthlyValue: number | null;
  waitingDays: number;
}

export function UnassignedQueue({
  athletes,
  candidates,
  locale,
}: {
  athletes: QueueAthlete[];
  candidates: Candidate[];
  locale: Locale;
}) {
  const tr = translator(locale);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});

  if (athletes.length === 0) return null;

  async function assign(tenantId: string, staffId: string) {
    setBusy(tenantId);
    setErr(null);
    const res = await fetch("/api/coach/roster/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId, staffId }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res || !body?.ok) {
      setErr(body?.code === "taken" ? tr("queue.taken") : tr("queue.error"));
      setBusy(null);
      return;
    }
    router.refresh();
    setBusy(null);
  }

  return (
    <section className="mb-6 rounded-[16px] border border-[var(--bad)] bg-[var(--surface)] p-4 sm:p-5">
      <header className="mb-3">
        <h2 className="text-[15px] font-bold text-[var(--text)]">
          {tr("queue.title")} <span className="text-[var(--bad)]">({athletes.length})</span>
        </h2>
        <p className="mt-0.5 text-[12px] text-[var(--text-faint)]">{tr("queue.sub")}</p>
      </header>

      {err && <p className="mb-2 text-[12px] text-[var(--bad)]">{err}</p>}

      <ul className="flex flex-col gap-2">
        {athletes.map((a) => {
          const ranked = suggestCoach({ sports: a.sports, monthlyValue: a.monthlyValue }, candidates);
          const best = bestSuggestion(ranked);
          const picked = choice[a.tenantId] ?? best?.staffId ?? "";
          return (
            <li
              key={a.tenantId}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2.5"
            >
              <div className="min-w-[150px] flex-1">
                <p className="text-[13px] font-semibold text-[var(--text)]">{a.name}</p>
                <p className="text-[11.5px] text-[var(--text-faint)]">
                  {tr("queue.waiting").replace("{n}", String(a.waitingDays))}
                  {a.sports.length > 0 && ` · ${a.sports.join(" · ")}`}
                </p>
              </div>

              {best ? (
                <p className="min-w-[160px] flex-1 text-[11.5px] text-[var(--text-muted)]">
                  <span className="font-semibold text-[var(--lime)]">{best.name}</span>
                  {best.reasons.length > 0 && (
                    <> — {best.reasons.slice(0, 2).map((r) => tr(`queue.why.${r}` as TKey)).join(", ")}</>
                  )}
                </p>
              ) : (
                // Sem ninguém adequado o sistema cala em vez de chutar um nome —
                // e diz por quê, senão a ausência parece defeito.
                <p className="min-w-[160px] flex-1 text-[11.5px] text-[var(--warn)]">{tr("queue.noFit")}</p>
              )}

              <select
                value={picked}
                onChange={(e) => setChoice((c) => ({ ...c, [a.tenantId]: e.target.value }))}
                className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-soft)] px-2.5 py-1.5 text-[12.5px] text-[var(--text)]"
              >
                <option value="">{tr("queue.pick")}</option>
                {ranked.map((s) => (
                  <option key={s.staffId} value={s.staffId}>
                    {s.name}{s.fits ? "" : ` ${tr("queue.tight")}`}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => assign(a.tenantId, picked)}
                disabled={!picked || busy === a.tenantId}
                className="rounded-[10px] bg-[var(--lime)] px-3.5 py-1.5 text-[12.5px] font-bold text-[#0a0b0d] disabled:opacity-40"
              >
                {tr("queue.assign")}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Só para o tipo das chaves de motivo existir por extenso em um lugar. */
export type { ReasonKind };
