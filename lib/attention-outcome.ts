// ────────────────────────────────────────────────────────────────────────────
//  O desfecho de um alerta de retenção — a parte pura (sem banco).
//
//  A tela de atenção (lib/retention) diz quem ligar. Isto é o que se registra
//  DEPOIS: o coach contatou? o aluno ficou? saiu, e por quê? Cada registro é um
//  evento novo (só se acrescenta); o estado de um aluno é o mais recente.
//
//  Os códigos abaixo existem também como CHECK em
//  product/add-attention-outcomes.sql — product/tests/attention-outcome.ts
//  confere que as duas listas não se afastaram.
// ────────────────────────────────────────────────────────────────────────────

export const OUTCOMES = ["contacted", "stayed", "left"] as const;
export type OutcomeKind = (typeof OUTCOMES)[number];

/** Fechada de propósito: agregável, e sem espaço para dado de saúde. */
export const REASONS = [
  "price", "time", "health", "results", "motivation",
  "other_coach", "life_event", "service", "unknown", "other",
] as const;
export type OutcomeReason = (typeof REASONS)[number];

export const NOTE_MAX = 280;

export interface OutcomeInput {
  outcome: OutcomeKind;
  /** Presente se, e somente se, o aluno saiu. */
  reason: OutcomeReason | null;
  note: string | null;
}

export type OutcomeParse =
  | { ok: true; value: OutcomeInput }
  | { ok: false; code: "bad_outcome" | "reason_required" | "reason_not_allowed" | "bad_reason" };

const isOutcome = (v: unknown): v is OutcomeKind => typeof v === "string" && (OUTCOMES as readonly string[]).includes(v);
const isReason = (v: unknown): v is OutcomeReason => typeof v === "string" && (REASONS as readonly string[]).includes(v);

/** Tira caracteres de controle e espaços repetidos; vazio vira null. */
export function cleanNote(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  return s.length ? s : null;
}

/** O que veio do navegador → o que pode ser gravado. Nada aqui é confiável. */
export function parseOutcomeInput(body: { outcome?: unknown; reason?: unknown; note?: unknown } | null): OutcomeParse {
  if (!isOutcome(body?.outcome)) return { ok: false, code: "bad_outcome" };
  const outcome = body.outcome;
  const hasReason = body.reason !== undefined && body.reason !== null && body.reason !== "";

  if (outcome === "left") {
    if (!hasReason) return { ok: false, code: "reason_required" };
    if (!isReason(body.reason)) return { ok: false, code: "bad_reason" };
    return { ok: true, value: { outcome, reason: body.reason, note: cleanNote(body.note) } };
  }
  // Um motivo num "ficou"/"contatado" não é dado novo — é ruído que quebraria a
  // regra do banco; recusado em vez de descartado em silêncio.
  if (hasReason) return { ok: false, code: "reason_not_allowed" };
  return { ok: true, value: { outcome, reason: null, note: cleanNote(body.note) } };
}

/** O evento mais recente de um aluno, como a tela o mostra. */
export interface LatestOutcome {
  outcome: OutcomeKind;
  reason: OutcomeReason | null;
  note: string | null;
  /** ISO. */
  at: string;
  by: string | null;
}

/**
 * Quem saiu desce para o fim da fila. Continuam visíveis — o dono precisa ver
 * quem já foi para decidir a carteira — mas não disputam a atenção de quem
 * ainda dá para salvar. Ordem relativa preservada nos dois grupos.
 */
export function sinkLeft<T extends { tenant_id: string }>(
  list: T[],
  latest: ReadonlyMap<string, LatestOutcome> | Record<string, LatestOutcome | undefined>,
): T[] {
  const get = (id: string) => (latest instanceof Map ? latest.get(id) : (latest as Record<string, LatestOutcome | undefined>)[id]);
  const stay: T[] = [];
  const gone: T[] = [];
  for (const row of list) (get(row.tenant_id)?.outcome === "left" ? gone : stay).push(row);
  return [...stay, ...gone];
}

const DAY = 86_400_000;

/** Dias inteiros entre o evento e "hoje" (na zona da assessoria), nunca negativo. */
export function daysAgo(atISO: string, todayISO: string): number {
  const a = Date.parse(`${atISO.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${todayISO.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / DAY));
}
