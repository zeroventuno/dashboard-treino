// ────────────────────────────────────────────────────────────────────────────
//  O placar por profissional — a linha do painel-mãe.
//
//  A unidade aqui é o TREINADOR, não o atleta. Empilhar todos os atletas da
//  assessoria numa lista só é a versão que quebra exatamente nos 200 alunos que
//  são a meta: o dono não pergunta "quem eu ligo hoje" (isso é a tela de
//  atenção, que já existe e é do treinador), ele pergunta "qual carteira está
//  derrapando, quem está estourado, onde vaza dinheiro".
//
//  Tudo aqui é função pura sobre linhas já avaliadas por lib/retention, para
//  poder ser testado sem banco — e porque errar uma conta de margem em silêncio
//  é pior do que não ter a conta.
// ────────────────────────────────────────────────────────────────────────────
import type { Assessed } from "./retention";

/** Como a casa paga este profissional. Ver product/add-agency-management.sql. */
export type PayModel = "pct" | "per_athlete" | "salary";

export interface StaffInfo {
  id: string;
  name: string | null;
  role: string;
  isOwner?: boolean;
  /** Modalidades que este profissional programa. VAZIO = sem restrição
   * declarada, nunca "nenhuma" — mesma regra do resto do painel. */
  sports?: string[];
  /** Quantos alunos esta pessoa aguenta. Nulo = a assessoria não declarou. */
  maxAthletes?: number | null;
  payModel?: PayModel | null;
  payValue?: number | null;
}

export interface CoachScore {
  staffId: string;
  name: string;
  role: string;
  athletes: number;
  active: number;
  atRisk: number;
  inactive: number;
  newAthletes: number;
  /** Alunos sem mensalidade definida — a receita abaixo NÃO os inclui. */
  unpriced: number;
  /** Soma das mensalidades da carteira. */
  revenue: number;
  /** Mensalidade parada em aluno em risco ou inativo. */
  revenueAtRisk: number;
  /** O que a casa paga por esta carteira, ou null quando não há modelo. */
  cost: number | null;
  /** revenue − cost, ou null quando o custo é desconhecido. */
  margin: number | null;
  /** Custo por aluno. Com salário fixo cai conforme a carteira enche — que é
   * justamente o que torna capacidade e margem a mesma conversa. */
  costPerAthlete: number | null;
  maxAthletes: number | null;
  /** Ocupação 0..1+ (pode passar de 1: estourado é informação, não erro). */
  load: number | null;
  /** Fatia da carteira que NÃO está em risco nem inativa, 0..1. */
  healthy: number;
}

/**
 * O que a casa paga por esta carteira.
 *
 * Devolve null quando não há modelo declarado, e null se propaga até a margem.
 * Zero seria uma AFIRMAÇÃO — margem igual à receita inteira — e uma assessoria
 * que ainda não preencheu isso veria lucro imaginário em todo mundo.
 */
export function coachCost(s: StaffInfo, revenue: number, athletes: number): number | null {
  if (!s.payModel || s.payValue == null) return null;
  switch (s.payModel) {
    // Fatia do que os alunos pagam: sai da receita CONTABILIZADA, então uma
    // carteira com aluno sem preço subestima os dois lados igualmente e a
    // margem continua honesta. Por isso `unpriced` viaja junto no placar.
    case "pct":
      return round2((revenue * s.payValue) / 100);
    // Por aluno ATIVO na carteira, tenha preço ou não — a casa paga pelo
    // trabalho, não pelo cadastro estar completo.
    case "per_athlete":
      return round2(s.payValue * athletes);
    case "salary":
      return round2(s.payValue);
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Uma linha de placar por profissional.
 *
 * `book` são os atletas DESTE profissional, já avaliados. Um profissional sem
 * carteira nenhuma continua aparecendo, com zeros: sumir da comparação é
 * exatamente o que esconderia alguém ocioso.
 */
export function scoreCoach(s: StaffInfo, book: Assessed[]): CoachScore {
  let active = 0, atRisk = 0, inactive = 0, newAthletes = 0;
  let revenue = 0, revenueAtRisk = 0, unpriced = 0;

  for (const a of book) {
    if (a.state === "active") active++;
    else if (a.state === "at_risk") atRisk++;
    else if (a.state === "inactive") inactive++;
    else newAthletes++;

    const v = a.monthly_value == null ? null : Number(a.monthly_value);
    if (v == null || !Number.isFinite(v)) unpriced++;
    else {
      revenue += v;
      if (a.state === "at_risk" || a.state === "inactive") revenueAtRisk += v;
    }
  }

  const athletes = book.length;
  revenue = round2(revenue);
  const cost = coachCost(s, revenue, athletes);
  const max = s.maxAthletes ?? null;

  return {
    staffId: s.id,
    name: s.name?.trim() || s.role,
    role: s.role,
    athletes, active, atRisk, inactive, newAthletes, unpriced,
    revenue,
    revenueAtRisk: round2(revenueAtRisk),
    cost,
    margin: cost == null ? null : round2(revenue - cost),
    costPerAthlete: cost == null || athletes === 0 ? null : round2(cost / athletes),
    maxAthletes: max,
    load: max ? round2(athletes / max) : null,
    // Carteira vazia é 1 (nada doente), não 0 — senão um profissional recém
    // contratado apareceria no fim do ranking de saúde por não ter ninguém.
    healthy: athletes === 0 ? 1 : round2((athletes - atRisk - inactive) / athletes),
  };
}

/** O placar inteiro, uma linha por profissional. */
export function scoreAgency(staff: StaffInfo[], books: Map<string, Assessed[]>): CoachScore[] {
  return staff.map((s) => scoreCoach(s, books.get(s.id) ?? []));
}

/** As métricas que a barra ranqueada sabe ordenar — as abas do gráfico. */
export const RANK_METRICS = [
  "athletes", "revenue", "margin", "healthy", "load", "revenueAtRisk", "costPerAthlete",
] as const;
export type RankMetric = (typeof RANK_METRICS)[number];

/**
 * Ordena o placar pela métrica escolhida, maior primeiro.
 *
 * Quem não tem a métrica vai para o FIM em vez de virar zero: um treinador sem
 * modelo de pagamento não tem margem zero, tem margem desconhecida, e deixá-lo
 * no fundo do ranking de margem seria inventar um fato sobre ele.
 */
export function rankBy(rows: CoachScore[], metric: RankMetric): CoachScore[] {
  return [...rows].sort((a, b) => {
    const x = a[metric];
    const y = b[metric];
    if (x == null && y == null) return a.name.localeCompare(b.name);
    if (x == null) return 1;
    if (y == null) return -1;
    return y - x || a.name.localeCompare(b.name);
  });
}

/**
 * Soma do placar — o topo do painel-mãe.
 *
 * Custo e margem só somam quando TODOS os profissionais têm modelo. Somar o que
 * se conhece e apresentar como total da assessoria seria um número que parece
 * completo e não é; `costKnown` deixa a UI dizer isso em vez de esconder.
 */
export function agencyRollup(rows: CoachScore[]) {
  const costKnown = rows.length > 0 && rows.every((r) => r.cost != null);
  const sum = (f: (r: CoachScore) => number) => round2(rows.reduce((t, r) => t + f(r), 0));
  const athletes = sum((r) => r.athletes);
  const revenue = sum((r) => r.revenue);
  const cost = costKnown ? sum((r) => r.cost ?? 0) : null;
  return {
    staff: rows.length,
    athletes,
    revenue,
    revenueAtRisk: sum((r) => r.revenueAtRisk),
    atRisk: sum((r) => r.atRisk),
    inactive: sum((r) => r.inactive),
    unpriced: sum((r) => r.unpriced),
    cost,
    margin: cost == null ? null : round2(revenue - cost),
    /** Falso quando algum profissional está sem modelo — a UI avisa. */
    costKnown,
  };
}
