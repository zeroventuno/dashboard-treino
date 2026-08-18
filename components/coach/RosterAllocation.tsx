"use client";

// Redistribuir alunos entre profissionais, vendo o efeito ANTES de confirmar.
//
// A parte valiosa não é arrastar — é a prévia. Mover aluno não muda só a carga:
// muda a margem dos dois lados, e de formas diferentes conforme o modelo de
// pagamento (por aluno o custo migra junto; em % ele acompanha a mensalidade
// daquele aluno específico; com salário o custo total não muda em ninguém, mas
// o custo POR aluno muda nos dois). Sem ver isso, realocar parece de graça.
//
// A simulação não custa consulta nenhuma: `scoreCoach` é função pura da
// carteira, então a prévia é a mesma função com a lista já modificada.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { scoreCoach, type CoachScore, type StaffInfo } from "@/lib/agency-metrics";
import type { Assessed } from "@/lib/retention";
import { translator, type Locale, type T } from "@/lib/i18n";
import { DisciplineIcon } from "@/components/Icons";

const SPORTS = ["swim", "bike", "run", "strength"] as const;

/**
 * A row of the four discipline icons, lit for what this person (athlete or
 * coach) actually does — so pairing them is a glance, not a read of two text
 * lists. An empty `active` means "no restriction declared", the same rule
 * `specialtyFit` uses, so it's drawn as every icon lit but faint rather than
 * as every icon off — off would read as "programs nothing", which is the one
 * thing an empty list never means here.
 */
function SportBadges({ active }: { active: string[] }) {
  const noSignal = active.length === 0;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-[3px]"
      title={noSignal ? "Sem restrição declarada" : active.join(" · ")}
    >
      {SPORTS.map((s) => {
        const on = noSignal || active.includes(s);
        return (
          <DisciplineIcon
            key={s}
            discipline={s}
            size={12}
            style={{ color: on ? `var(--${s})` : "var(--text-faint)", opacity: on ? (noSignal ? 0.45 : 1) : 0.3 }}
          />
        );
      })}
    </span>
  );
}

export interface BoardAthlete {
  tenantId: string;
  name: string;
  /** Estado de retenção, para o card mostrar quem está em risco. */
  state: Assessed["state"];
  monthlyValue: string | null;
  /** Modalidades que este aluno treina — cruzam com `sports` do profissional. */
  sports: string[];
}

export function RosterAllocation({
  staff,
  athletes,
  assignment,
  currency,
  locale,
}: {
  staff: StaffInfo[];
  athletes: BoardAthlete[];
  /** staffId → tenantIds da carteira dele, como está HOJE no banco. */
  assignment: Record<string, string[]>;
  currency: string;
  locale: Locale;
}) {
  const tr = translator(locale);
  const router = useRouter();

  const byId = useMemo(() => new Map(athletes.map((a) => [a.tenantId, a])), [athletes]);
  // Estado local é a verdade enquanto o dono mexe; o servidor só entra no
  // confirmar. Mesma lição dos toggles de modalidade: derivar cada clique do
  // prop do servidor faz o segundo desfazer o primeiro.
  const [draft, setDraft] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(staff.map((s) => [s.id, [...(assignment[s.id] ?? [])]])),
  );
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  /** Onde cada aluno está no rascunho — a origem de um movimento. */
  const draftOwner = useMemo(() => {
    const m = new Map<string, string>();
    for (const [sid, ids] of Object.entries(draft)) for (const id of ids) m.set(id, sid);
    return m;
  }, [draft]);

  const original = useMemo(() => {
    const m = new Map<string, string>();
    for (const [sid, ids] of Object.entries(assignment)) for (const id of ids) m.set(id, sid);
    return m;
  }, [assignment]);

  const moves = useMemo(
    () =>
      [...draftOwner.entries()]
        .filter(([tid, sid]) => original.get(tid) && original.get(tid) !== sid)
        .map(([tid, sid]) => ({ tenantId: tid, fromStaffId: original.get(tid)!, toStaffId: sid })),
    [draftOwner, original],
  );

  const book = (ids: string[]): Assessed[] =>
    ids
      .map((id) => byId.get(id))
      .filter((a): a is BoardAthlete => !!a)
      .map((a) => ({ state: a.state, monthly_value: a.monthlyValue } as Assessed));

  function moveTo(toStaffId: string) {
    if (picked.size === 0) return;
    setDraft((d) => {
      const next: Record<string, string[]> = {};
      for (const [sid, ids] of Object.entries(d)) next[sid] = ids.filter((id) => !picked.has(id));
      next[toStaffId] = [...next[toStaffId], ...picked];
      return next;
    });
    setPicked(new Set());
  }

  async function confirm() {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/coach/roster/reassign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moves }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (!res || !res.ok || !body?.ok) {
      setMsg(tr("roster.error"));
      setBusy(false);
      return;
    }
    // Fala o número REAL: linhas de outra assessoria são puladas, não falham.
    if (body.moved < body.asked) setMsg(tr("roster.partial").replace("{n}", String(body.moved)).replace("{t}", String(body.asked)));
    router.refresh();
    setBusy(false);
  }

  return (
    <>
      {/* Barra de ação: só existe quando há algo selecionado ou pendente. */}
      {(picked.size > 0 || moves.length > 0) && (
        <div className="sticky top-[58px] z-30 mb-4 flex flex-wrap items-center gap-2 rounded-[12px] border border-[var(--lime)] bg-[var(--surface)] px-3 py-2.5">
          {picked.size > 0 && (
            <>
              <span className="text-[12.5px] font-semibold text-[var(--text)]">
                {tr("roster.selected").replace("{n}", String(picked.size))}
              </span>
              <select
                defaultValue=""
                onChange={(e) => { if (e.target.value) { moveTo(e.target.value); e.target.value = ""; } }}
                className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-soft)] px-2.5 py-1.5 text-[12.5px] text-[var(--text)]"
              >
                <option value="">{tr("roster.moveTo")}</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name?.trim() || s.role}</option>
                ))}
              </select>
              <button type="button" onClick={() => setPicked(new Set())} className="text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]">
                {tr("roster.clear")}
              </button>
            </>
          )}
          {moves.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[12.5px] text-[var(--text-muted)]">
                {tr("roster.pending").replace("{n}", String(moves.length))}
              </span>
              <button
                type="button"
                onClick={() => { setDraft(Object.fromEntries(staff.map((s) => [s.id, [...(assignment[s.id] ?? [])]]))); setPicked(new Set()); }}
                className="rounded-[10px] border border-[var(--border)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--text)]"
              >
                {tr("roster.undo")}
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={busy}
                className="rounded-[10px] bg-[var(--lime)] px-4 py-1.5 text-[12.5px] font-bold text-[#0a0b0d] disabled:opacity-40"
              >
                {tr("roster.confirm")}
              </button>
            </div>
          )}
        </div>
      )}
      {msg && <p className="mb-3 text-[12px] text-[var(--bad)]">{msg}</p>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {staff.map((s) => {
          const now = scoreCoach(s, book(assignment[s.id] ?? []));
          const after = scoreCoach(s, book(draft[s.id] ?? []));
          const changed = now.athletes !== after.athletes;
          return (
            <section key={s.id} className="rounded-[14px] border border-[var(--border-soft)] bg-[var(--surface)] p-3.5">
              <header className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="truncate text-[14px] font-bold text-[var(--text)]">{after.name}</h2>
                <SportBadges active={s.sports ?? []} />
              </header>

              <CapacityBar now={now} after={after} tr={tr} />
              <Deltas now={now} after={after} changed={changed} currency={currency} tr={tr} />

              <ul className="mt-2.5 flex flex-col gap-1">
                {(draft[s.id] ?? []).map((id) => {
                  const a = byId.get(id);
                  if (!a) return null;
                  const isMoved = original.get(id) !== s.id;
                  const on = picked.has(id);
                  // O cruzamento que o Rafael pediu: modalidade do aluno que o
                  // profissional NÃO declara programar. Sinaliza, nunca impede —
                  // `sports` vazio quer dizer "sem restrição", não "nenhuma".
                  const mismatch =
                    (s.sports?.length ?? 0) > 0 && a.sports.length > 0 &&
                    !a.sports.some((x) => s.sports!.includes(x));
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() =>
                          setPicked((p) => {
                            const n = new Set(p);
                            n.has(id) ? n.delete(id) : n.add(id);
                            return n;
                          })
                        }
                        className={`flex w-full items-center gap-2 rounded-[9px] border px-2.5 py-1.5 text-left transition-colors ${
                          on ? "border-[var(--lime)] bg-[var(--surface-3)]" : "border-[var(--border-soft)] hover:border-[var(--border)]"
                        } ${isMoved ? "border-dashed" : ""}`}
                      >
                        <span
                          className="h-[7px] w-[7px] shrink-0 rounded-full"
                          style={{
                            background:
                              a.state === "at_risk" ? "var(--warn)"
                              : a.state === "inactive" ? "var(--bad)"
                              : a.state === "new" ? "var(--lime)"
                              : "var(--text-faint)",
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text)]">{a.name}</span>
                        <SportBadges active={a.sports} />
                        {mismatch && <span className="shrink-0 text-[11px] text-[var(--warn)]" title={tr("roster.mismatch")}>△</span>}
                        {a.monthlyValue && (
                          <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-faint)]">{a.monthlyValue}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
                {(draft[s.id] ?? []).length === 0 && (
                  <li className="px-1 py-2 text-[12px] text-[var(--text-faint)]">{tr("roster.empty")}</li>
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

/**
 * Barra de capacidade com a extensão fantasma — a ideia do Rafael.
 *
 * Sólido = o que ele carrega hoje. Listrado = para onde vai se confirmar. Sem
 * alvo declarado a barra não aparece: desenhar uma régua sem saber o limite
 * inventaria uma folga (ou um estouro) que ninguém afirmou.
 */
function CapacityBar({ now, after, tr }: { now: CoachScore; after: CoachScore; tr: T }) {
  const max = after.maxAthletes;
  if (!max) {
    return (
      <p className="text-[11.5px] text-[var(--text-faint)]">
        {after.athletes} {now.athletes !== after.athletes && <em className="not-italic text-[var(--lime)]">({after.athletes > now.athletes ? "+" : ""}{after.athletes - now.athletes})</em>}
      </p>
    );
  }
  // Escala pelo maior entre alvo e realidade: uma carteira acima do teto tem que
  // caber na régua, senão estourar vira invisível justo quando mais importa.
  const scale = Math.max(max, now.athletes, after.athletes);
  const pctNow = (Math.min(now.athletes, after.athletes) / scale) * 100;
  const pctAfter = (after.athletes / scale) * 100;
  const growing = after.athletes > now.athletes;
  const over = after.athletes > max;

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[11.5px]">
        <span className={over ? "font-semibold text-[var(--bad)]" : "text-[var(--text-muted)]"}>
          {after.athletes} / {max}
        </span>
        {now.athletes !== after.athletes && (
          <span className="text-[var(--text-faint)]">
            {tr("roster.was")} {now.athletes}
          </span>
        )}
      </div>
      <div className="relative h-[9px] overflow-hidden rounded-full bg-[var(--surface-3)]">
        {/* Marca do teto, quando a carteira já passou dele. */}
        {over && (
          <span className="absolute top-0 z-10 h-full w-px bg-[var(--text)]" style={{ left: `${(max / scale) * 100}%` }} />
        )}
        {/* Fantasma primeiro, sólido por cima: crescer mostra listras à frente,
            encolher mostra listras onde a carteira deixa de estar. */}
        <span
          className="absolute left-0 top-0 h-full rounded-full"
          style={{
            width: `${pctAfter}%`,
            background: growing
              ? "repeating-linear-gradient(45deg, var(--lime) 0 4px, transparent 4px 8px)"
              : "var(--lime)",
            opacity: growing ? 0.75 : 1,
          }}
        />
        {!growing && now.athletes !== after.athletes && (
          <span
            className="absolute left-0 top-0 h-full"
            style={{
              width: `${(now.athletes / scale) * 100}%`,
              background: "repeating-linear-gradient(45deg, var(--text-faint) 0 4px, transparent 4px 8px)",
              opacity: 0.5,
            }}
          />
        )}
        <span
          className="absolute left-0 top-0 h-full rounded-full"
          style={{ width: `${pctNow}%`, background: over ? "var(--bad)" : "var(--lime)" }}
        />
      </div>
    </div>
  );
}

/** Margem e custo/aluno, com o valor futuro só quando algo mudou. */
function Deltas({
  now, after, changed, currency, tr,
}: { now: CoachScore; after: CoachScore; changed: boolean; currency: string; tr: T }) {
  const money = (v: number | null) =>
    v == null ? "—" : `${currency} ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  const row = (label: string, a: number | null, b: number | null) => (
    <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
      <span className="text-[var(--text-faint)]">{label}</span>
      <span className="tabular-nums text-[var(--text-muted)]">
        {money(a)}
        {changed && a !== b && (
          <span className={b != null && a != null && b > a ? "text-[var(--lime)]" : "text-[var(--bad)]"}> → {money(b)}</span>
        )}
      </span>
    </div>
  );
  return (
    <div className="mt-2 flex flex-col gap-0.5 border-t border-[var(--border-soft)] pt-2">
      {row(tr("agency.m.margin"), now.margin, after.margin)}
      {row(tr("agency.m.costPer"), now.costPerAthlete, after.costPerAthlete)}
    </div>
  );
}
