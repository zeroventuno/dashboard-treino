// ────────────────────────────────────────────────────────────────────────────
//  Threshold testing: the protocols, and who is overdue for one.
//
//  Every number this product computes hangs off a threshold. Zones come from it,
//  the prescribed unit comes from the zones, time-in-zone is scored against
//  them, and TSS is intensity-over-threshold squared. A threshold measured in
//  March and still in use in September doesn't just go stale — it makes an
//  athlete who improved look like they're training easier, because the same
//  effort now sits lower against a number that never moved.
//
//  So testing is not an extra feature. It is the maintenance the rest depends
//  on, and nothing in the product asked for it.
//
//  Protocols are TrainingPeaks' and Joe Friel's, not invented here. Friel's
//  power zones (<55, 55-74, 75-89, 90-104, 105-120) also confirm the breakpoints
//  lib/prescription already used to turn an intensity into a zone.
// ────────────────────────────────────────────────────────────────────────────

import type { Discipline, PerformanceMilestone } from "./types";
import { daysBetween } from "./utils";

/** The milestone metric each discipline's threshold is logged under. These are
 * the names already in use by the season timeline, so a test result and the
 * dot on the season chart are the same record. */
export const THRESHOLD_METRIC: Partial<Record<Discipline, string>> = {
  bike: "FTP",
  run: "run_pace_threshold",
  swim: "swim_pace_100m",
};

export interface Protocol {
  discipline: Discipline;
  /** Short name for the session title. */
  name: string;
  /** What the athlete actually does. */
  effort: string;
  /** How the raw result becomes a threshold — the part everyone gets wrong. */
  conversion: string;
  /** Roughly how long the whole session takes, warm-up included. */
  minutes: number;
}

/**
 * One primary protocol per discipline, plus a shorter alternative.
 *
 * Primary is Friel's 30-minute time trial everywhere it applies: it needs no
 * correction factor, which is exactly why it's harder to get wrong. The 20-min
 * bike test is more popular and needs the 5% subtraction — a step that, skipped,
 * inflates FTP by 5% and quietly makes every subsequent session score too easy.
 */
export const PROTOCOLS: Record<string, Protocol> = {
  bike_30: {
    discipline: "bike",
    name: "30min time trial",
    effort: "Aquecimento completo, depois 30min contrarrelógio no máximo sustentável, sozinho.",
    conversion: "FTP = potência média dos 30min inteiros. Sem correção.",
    minutes: 60,
  },
  bike_20: {
    discipline: "bike",
    name: "20min time trial",
    effort: "Aquecimento completo, depois 20min no máximo sustentável.",
    conversion: "FTP = média dos 20min MENOS 5%. Pular esse desconto infla o FTP e faz todo treino seguinte parecer fácil demais.",
    minutes: 50,
  },
  run_30: {
    discipline: "run",
    name: "30min time trial",
    effort: "30min no máximo sustentável, em piso plano. Marque a volta aos 10min.",
    conversion: "Limiar = pace médio dos ÚLTIMOS 20min (não dos 30). A FC média desses mesmos 20min é a LTHR.",
    minutes: 55,
  },
  run_race: {
    discipline: "run",
    name: "Prova de 5K ou 10K",
    effort: "Uma prova recente serve — não precisa testar de novo.",
    conversion: "Converta o tempo de prova para pace de limiar. Prova mais longa que 10K subestima o limiar.",
    minutes: 0,
  },
  swim_1000: {
    discipline: "swim",
    name: "1000m contrarrelógio",
    effort: "1000m contínuos no máximo sustentável, depois de aquecer.",
    conversion: "T-pace = tempo total ÷ 10 = ritmo por 100m.",
    minutes: 45,
  },
  swim_css: {
    discipline: "swim",
    name: "CSS (400m + 200m)",
    effort: "400m no máximo, descanso completo, depois 200m no máximo.",
    conversion: "CSS por 100m = (tempo400 − tempo200) ÷ 2. Ex.: 6:00 e 3:00 → 90s/100m.",
    minutes: 45,
  },
};

/** Friel's own guidance is to retest every 4-6 weeks. Six is the top of that
 * range and the one used here: a triathlete retesting three disciplines every
 * four weeks spends a quarter of the season testing. */
export const RETEST_WEEKS = 6;
/** Flagged a week early, so a test week can be planned rather than improvised. */
const WARN_WEEKS = RETEST_WEEKS - 1;

export type TestState = "never" | "ok" | "soon" | "due";

export interface TestStatus {
  discipline: Discipline;
  state: TestState;
  lastISO: string | null;
  weeksSince: number | null;
}

/**
 * Where each discipline stands, from the milestone log.
 *
 * "never" is deliberately distinct from "due". An athlete who has never been
 * tested has no threshold at all, so every zone they own is a guess — that is a
 * different conversation from one whose numbers have simply aged, and it should
 * not be buried in the same bucket.
 */
export function testStatus(
  milestones: PerformanceMilestone[],
  disciplines: Discipline[],
  todayISO: string,
  retestWeeks = RETEST_WEEKS,
): TestStatus[] {
  return disciplines.map((discipline) => {
    const metric = THRESHOLD_METRIC[discipline];
    const latest = metric
      ? milestones
          .filter((m) => m.metric === metric && m.date <= todayISO)
          .reduce<PerformanceMilestone | null>((best, m) => (!best || m.date > best.date ? m : best), null)
      : null;

    if (!latest) return { discipline, state: "never", lastISO: null, weeksSince: null };

    const weeksSince = daysBetween(latest.date, todayISO) / 7;
    const state: TestState = weeksSince >= retestWeeks ? "due" : weeksSince >= WARN_WEEKS ? "soon" : "ok";
    return { discipline, state, lastISO: latest.date, weeksSince: Math.floor(weeksSince) };
  });
}

/** Disciplines needing attention, worst first — never-tested ahead of overdue,
 * because a missing threshold breaks more than a stale one. */
export function needsTesting(status: TestStatus[]): TestStatus[] {
  const rank: Record<TestState, number> = { never: 0, due: 1, soon: 2, ok: 3 };
  return status
    .filter((s) => s.state !== "ok")
    .sort((a, b) => rank[a.state] - rank[b.state] || (b.weeksSince ?? 999) - (a.weeksSince ?? 999));
}
