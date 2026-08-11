// ────────────────────────────────────────────────────────────────────────────
//  A lista do dia — o que este profissional precisa fazer, já ordenada.
//
//  Rafael trabalha por lista de tarefas: abrir a ferramenta e receber, pronto,
//  o que fazer hoje em ordem de importância. Isso muda onde a lista mora — ela
//  não é um aviso a ser consultado, é a primeira coisa da tela — e muda o que
//  entra nela: só cabe o que tem uma AÇÃO do outro lado. "12 alunos ativos" é
//  informação e não pertence aqui; "João sem treinador há 6 dias" é tarefa.
//
//  Server-only: chama os leitores do product-db. Fica separado da página para
//  que o sino (contador) e a lista leiam exatamente a mesma coisa — dois
//  cálculos paralelos divergiriam, e um sino mentindo sobre o número é pior do
//  que não ter sino.
// ────────────────────────────────────────────────────────────────────────────
import { getRoster, getBank, getUnassignedAthletes } from "./product-db";
import { daysBetween, toISO } from "./utils";
import { translator, type Locale } from "./i18n";

/** 0 = hoje, 1 = esta semana, 2 = quando der. Ordena a lista inteira. */
export type Severity = 0 | 1 | 2;

export interface Signal {
  severity: Severity;
  /** Agrupador na UI e chave de deduplicação. */
  kind: "unassigned" | "red" | "injury" | "stale" | "drafts";
  text: string;
  href: string;
}

export interface SignalStaff {
  id: string;
  agencyId: string;
  role: string;
  isOwner: boolean;
}

/**
 * Tudo que este profissional deveria fazer, mais urgente primeiro.
 *
 * O escopo segue o do resto do painel: cada um vê a própria carteira, e só o
 * DONO vê o que é da assessoria (aluno sem treinador não é tarefa de um
 * treinador específico — não existe ninguém a quem cobrar até alguém atribuir).
 */
export async function collectSignals(staff: SignalStaff, locale: Locale): Promise<Signal[]> {
  const tr = translator(locale);
  const todayISO = toISO(new Date());
  const out: Signal[] = [];

  // Aluno sem treinador vem PRIMEIRO e é severidade máxima de propósito: ele
  // pode já estar pagando e não recebe nada, e ninguém é avisado hoje porque
  // ele não aparece em roster nenhum. É o único item da lista em que o silêncio
  // do sistema é a própria falha.
  if (staff.isOwner) {
    for (const a of await getUnassignedAthletes(staff.agencyId)) {
      const days = daysBetween(a.created_at, todayISO);
      out.push({
        severity: 0,
        kind: "unassigned",
        text: `${a.name} — ${tr("coach.notif.unassigned").replace("{n}", String(days ?? 0))}`,
        href: "/coach/agency/roster",
      });
    }
  }

  for (const a of await getRoster(staff.id)) {
    const to = `/coach/a/${a.tenant_id}`;
    const who = a.athlete ?? a.name;
    if (a.today_reco === "red") out.push({ severity: 0, kind: "red", text: `${who} — ${tr("coach.notif.red")}`, href: to });
    if (a.recent_injuries > 0) out.push({ severity: 1, kind: "injury", text: `${who} — ${tr("coach.notif.injury")}`, href: to });
    const ago = a.last_checkin ? daysBetween(a.last_checkin, todayISO) : null;
    if (ago === null || ago > 3) {
      out.push({
        severity: 2,
        kind: "stale",
        text: `${who} — ${ago === null ? tr("coach.noCheckin") : tr("coach.notif.stale").replace("{n}", String(ago))}`,
        href: to,
      });
    }
  }

  if (staff.role === "coach") {
    const drafts = (await getBank(staff.agencyId)).filter((w) => w.status === "draft").length;
    if (drafts > 0) {
      out.push({ severity: 1, kind: "drafts", text: tr("coach.notif.drafts").replace("{n}", String(drafts)), href: "/coach/bank" });
    }
  }

  return out.sort((x, y) => x.severity - y.severity);
}
