// ────────────────────────────────────────────────────────────────────────────
//  Para qual profissional vai este aluno?
//
//  O sistema SUGERE, uma pessoa confirma. Nunca atribui sozinho: o dono conhece
//  coisas que o banco não tem — quem está de férias, quem não se dá bem com
//  quem, quem pediu para não pegar mais ninguém este mês.
//
//  Por isso toda sugestão vem com os MOTIVOS. Uma nota sem explicação não é
//  usada por quem gerencia — ou ele confia cegamente, o que é pior do que
//  escolher na mão, ou ignora. As razões são o produto tanto quanto a ordem.
// ────────────────────────────────────────────────────────────────────────────
import type { StaffInfo } from "./agency-metrics";

export interface Candidate {
  staff: StaffInfo;
  /** Tamanho da carteira hoje. */
  athletes: number;
  /** Receita da carteira hoje — base do custo marginal em modelo de %. */
  revenue: number;
}

export type ReasonKind =
  | "specialty" | "no_specialty" | "specialty_gap"
  | "room" | "full" | "over"
  | "light_book" | "heavy_book"
  | "free_marginal" | "costly";

export interface Suggestion {
  staffId: string;
  name: string;
  /** 0..100, comparável só dentro da mesma chamada. */
  score: number;
  reasons: ReasonKind[];
  /** O que a casa passa a pagar a mais por este aluno. Null = modelo não declarado. */
  marginalCost: number | null;
  /** Nada o desqualifica: especialidade não conflita E há vaga. */
  fits: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * O que a casa passa a gastar com UM aluno a mais nesta carteira.
 *
 * Zero com salário — e isso não é um detalhe contábil, é a razão pela qual um
 * profissional assalariado com vaga é quase sempre a alocação mais eficiente da
 * assessoria: o custo já está pago, ocioso.
 */
export function marginalCost(s: StaffInfo, athleteValue: number | null): number | null {
  if (!s.payModel || s.payValue == null) return null;
  if (s.payModel === "salary") return 0;
  if (s.payModel === "per_athlete") return s.payValue;
  return athleteValue == null ? 0 : Math.round(((athleteValue * s.payValue) / 100) * 100) / 100;
}

/** Fatia das modalidades do aluno que este profissional declara programar. */
export function specialtyFit(athleteSports: string[], staffSports: string[] | undefined): number | null {
  // VAZIO SIGNIFICA "SEM RESTRIÇÃO DECLARADA", NUNCA "NENHUMA" — a mesma regra
  // que vale no resto do painel. Ler como lista de permissão tornaria todo
  // profissional que nunca preencheu o campo inelegível para todo mundo.
  if (!staffSports || staffSports.length === 0) return null;
  if (athleteSports.length === 0) return null;
  const hit = athleteSports.filter((s) => staffSports.includes(s)).length;
  return hit / athleteSports.length;
}

/**
 * Ranqueia os profissionais para um aluno, melhor primeiro.
 *
 * Especialidade pesa mais que dinheiro de propósito: alocar um triatleta com
 * quem não programa natação porque sai mais barato é economizar no lugar errado.
 */
export function suggestCoach(
  athlete: { sports: string[]; monthlyValue: number | null },
  candidates: Candidate[],
): Suggestion[] {
  if (candidates.length === 0) return [];

  const avgBook = candidates.reduce((t, c) => t + c.athletes, 0) / candidates.length;
  const costs = candidates.map((c) => marginalCost(c.staff, athlete.monthlyValue));
  const known = costs.filter((c): c is number => c != null);
  const loCost = known.length ? Math.min(...known) : 0;
  const hiCost = known.length ? Math.max(...known) : 0;

  const out = candidates.map((c, i): Suggestion => {
    const reasons: ReasonKind[] = [];
    let score = 0;

    // ── Especialidade (0..40) ────────────────────────────────────────────
    const fit = specialtyFit(athlete.sports, c.staff.sports);
    if (fit == null) {
      score += 20; // sem sinal: nem prêmio nem castigo
      reasons.push("no_specialty");
    } else {
      score += 40 * fit;
      reasons.push(fit >= 0.999 ? "specialty" : "specialty_gap");
    }

    // ── Vaga (0..30) ─────────────────────────────────────────────────────
    const max = c.staff.maxAthletes ?? null;
    let hasRoom = true;
    if (max == null) {
      score += 15; // teto não declarado: desconhecido, não ilimitado
    } else if (c.athletes >= max) {
      hasRoom = false;
      reasons.push(c.athletes > max ? "over" : "full");
    } else {
      const free = (max - c.athletes) / max;
      score += 30 * free;
      reasons.push("room");
    }

    // ── Equilíbrio da assessoria (0..20) ─────────────────────────────────
    // O que o Rafael pediu por "equilibrar as carteiras": quem está abaixo da
    // média da casa sobe, quem está acima desce — independente de teto, porque
    // nem toda assessoria declara teto.
    if (avgBook > 0) {
      const rel = (avgBook - c.athletes) / avgBook;
      score += 20 * clamp((rel + 1) / 2, 0, 1);
      if (rel > 0.2) reasons.push("light_book");
      else if (rel < -0.2) reasons.push("heavy_book");
    } else {
      score += 10;
    }

    // ── Custo marginal (0..10) ───────────────────────────────────────────
    const mc = costs[i];
    if (mc == null) {
      score += 5; // modelo desconhecido: neutro, nunca "de graça"
    } else if (hiCost === loCost) {
      score += 10; // todos custam igual: não diferencia ninguém
    } else {
      score += 10 * (1 - (mc - loCost) / (hiCost - loCost));
      if (mc === 0) reasons.push("free_marginal");
      else if (mc === hiCost) reasons.push("costly");
    }

    return {
      staffId: c.staff.id,
      name: c.staff.name?.trim() || c.staff.role,
      score: Math.round(score * 10) / 10,
      reasons,
      marginalCost: mc,
      // Especialidade conflita quando ele DECLARA modalidades e nenhuma bate.
      fits: hasRoom && (fit == null || fit > 0),
    };
  });

  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/**
 * A sugestão a destacar, ou null quando não há uma defensável.
 *
 * Prefere alguém que CAIBA: um profissional lotado ou de especialidade
 * incompatível pode liderar a nota (uma carteira vazia pontua muito em
 * equilíbrio) e ainda assim ser a escolha errada. Sem ninguém que caiba,
 * devolve null — a lista continua visível para a pessoa decidir, mas o sistema
 * não põe o nome dele como recomendação.
 */
export function bestSuggestion(list: Suggestion[]): Suggestion | null {
  return list.find((s) => s.fits) ?? null;
}
