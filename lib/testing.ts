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

import type { Discipline, PerformanceMilestone, WorkoutBlock } from "./types";
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
  /**
   * What the athlete may swap this for.
   *
   * Zwift, MyWhoosh and the rest ship their own FTP tests, and they are these
   * protocols with small variations. Insisting on our version would mean an
   * athlete abandoning a guided test that works, inside the app they are
   * already pedalling in, to follow a block list on a second screen.
   *
   * What is NOT negotiable is the other half: the conversion, and logging the
   * result as a milestone. A platform test whose number never reaches the
   * dashboard leaves every zone stale anyway.
   */
  alternatives?: string;
  /**
   * The session as blocks, ready for upsert_workout.
   *
   * A test is a WORKOUT, not an instruction. Written as prose it can't be
   * exported to a watch, can't be drawn as a profile, and can't be scored by
   * the zone comparison — and the athlete improvises the warm-up, which is the
   * part that decides whether the number is any good. An FTP test done cold
   * reads low, and that low number then governs every session for six weeks.
   *
   * `intensity` is % of the CURRENT threshold, so the warm-up is prescribed in
   * the athlete's own units like any other session. The test block itself is
   * marked with a target rather than an intensity: its whole point is to find a
   * number nobody has yet.
   */
  blocks: WorkoutBlock[];
}

/** Recovery, in the athlete's easiest zone. */
const easy = (label: string, min: number): WorkoutBlock => ({
  label,
  duration_min: min,
  intensity: 55,
});

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
    alternatives:
      "Pode usar o teste de FTP do Zwift, MyWhoosh, TrainerRoad ou Wahoo SYSTM no lugar deste — são o mesmo protocolo com pequenas variações, e a plataforma te guia enquanto você pedala. O que NÃO muda: aplicar a conversão certa e registrar o resultado.",
    minutes: 62,
    blocks: [
      easy("Aquecimento", 15),
      { label: "Abertura 1/3", duration_min: 1, intensity: 95, target: "100+ rpm" },
      easy("Recuperação", 1),
      { label: "Abertura 2/3", duration_min: 1, intensity: 95, target: "100+ rpm" },
      easy("Recuperação", 1),
      { label: "Abertura 3/3", duration_min: 1, intensity: 95, target: "100+ rpm" },
      easy("Solto antes do teste", 5),
      { label: "TESTE — 30min contrarrelógio", duration_min: 30, target: "Máximo sustentável" },
      easy("Volta à calma", 10),
    ],
  },
  bike_20: {
    discipline: "bike",
    name: "20min time trial",
    effort: "Aquecimento com aberturas, um esforço de 5min para abrir, e então os 20min.",
    conversion: "FTP = média dos 20min MENOS 5%. Pular esse desconto infla o FTP e faz todo treino seguinte parecer fácil demais.",
    alternatives:
      "O teste de 20min do Zwift, MyWhoosh, TrainerRoad ou Wahoo SYSTM serve igual. ATENÇÃO: a maioria dessas plataformas já entrega o FTP com os 5% descontados — se a tela mostrar um FTP pronto, não desconte de novo.",
    minutes: 68,
    blocks: [
      easy("Aquecimento", 20),
      { label: "Abertura 1/3", duration_min: 1, intensity: 95, target: "100+ rpm" },
      easy("Recuperação", 1),
      { label: "Abertura 2/3", duration_min: 1, intensity: 95, target: "100+ rpm" },
      easy("Recuperação", 1),
      { label: "Abertura 3/3", duration_min: 1, intensity: 95, target: "100+ rpm" },
      easy("Solto", 5),
      // The 5-minute blow-out is not optional: without it the 20 minutes are
      // paced too conservatively and the resulting FTP reads low.
      { label: "5min forte (limpa as pernas)", duration_min: 5, target: "Máximo" },
      easy("Recuperação", 10),
      { label: "TESTE — 20min contrarrelógio", duration_min: 20, target: "Máximo sustentável" },
      easy("Volta à calma", 10),
    ],
  },
  bike_ramp: {
    discipline: "bike",
    name: "Ramp test",
    effort:
      "Rampa progressiva até a exaustão: a potência sobe um degrau a cada minuto e você pedala até não conseguir mais sustentar. Curto, e o mais fácil de fazer sozinho — quem tem pouco tempo faz este.",
    conversion: "FTP = 75% da melhor potência de 1 minuto. É a mesma conversão que Zwift e MyWhoosh aplicam.",
    alternatives:
      "É exatamente o teste embutido do Zwift e do MyWhoosh — prefira o deles, que controla a rampa no rolo e já faz a conversão. Este aqui existe para quem vai pedalar fora dessas plataformas.",
    minutes: 35,
    blocks: [
      easy("Aquecimento", 10),
      // No fixed intensity, because the session IS the ramp: the step rises
      // every minute until it can't be held, which is the measurement.
      { label: "TESTE — rampa até a exaustão", duration_min: 18, target: "+20W a cada minuto, até não sustentar" },
      easy("Volta à calma", 7),
    ],
  },
  run_30: {
    discipline: "run",
    name: "30min time trial",
    effort: "30min no máximo sustentável, em piso plano. Marque a volta aos 10min.",
    conversion: "Limiar = pace médio dos ÚLTIMOS 20min (não dos 30). A FC média desses mesmos 20min é a LTHR.",
    minutes: 55,
    blocks: [
      easy("Aquecimento", 15),
      { label: "TESTE — primeiros 10min", duration_min: 10, target: "Máximo sustentável" },
      // Split so the last 20 minutes are their own blocks: the conversion uses
      // only those, and a single 30-minute block would average in the first ten
      // that the protocol says to discard.
      { label: "TESTE — 20min que contam", duration_min: 20, target: "Máximo sustentável" },
      easy("Volta à calma", 10),
    ],
  },
  run_5k: {
    discipline: "run",
    name: "5K contrarrelógio",
    effort: "5km no máximo, em pista ou piso plano. Uma prova recente de 5K ou 10K substitui o teste.",
    conversion: "Converta o tempo de 5K para pace de limiar (o limiar fica ~3-5% mais lento que o pace de 5K). Prova mais longa que 10K subestima.",
    minutes: 50,
    blocks: [
      easy("Aquecimento", 15),
      { label: "Tiros curtos de soltura", duration_min: 3, intensity: 90 },
      easy("Solto", 3),
      { label: "TESTE — 5km", duration_min: 22, target: "Máximo" },
      easy("Volta à calma", 10),
    ],
  },
  swim_1000: {
    discipline: "swim",
    name: "1000m contrarrelógio",
    effort: "1000m contínuos no máximo sustentável, depois de aquecer.",
    conversion: "T-pace = tempo total ÷ 10 = ritmo por 100m.",
    minutes: 50,
    blocks: [
      easy("Aquecimento 400m solto", 10),
      { label: "Educativos + 4x50m progressivo", duration_min: 8, intensity: 85 },
      easy("Solto 100m", 3),
      { label: "TESTE — 1000m", duration_min: 18, target: "Máximo sustentável" },
      easy("Volta à calma 200m", 6),
    ],
  },
  swim_css: {
    discipline: "swim",
    name: "CSS (400m + 200m)",
    effort: "400m no máximo, descanso completo, depois 200m no máximo.",
    conversion: "CSS por 100m = (tempo400 − tempo200) ÷ 2. Ex.: 6:00 e 3:00 → 90s/100m.",
    minutes: 45,
    blocks: [
      easy("Aquecimento 400m solto", 10),
      { label: "Educativos + 4x50m progressivo", duration_min: 8, intensity: 85 },
      easy("Solto 100m", 3),
      { label: "TESTE 1 — 400m", duration_min: 7, target: "Máximo" },
      // Full recovery, not a token rest: the formula subtracts the two times,
      // so a tired 200m inflates CSS and makes every swim zone too easy.
      easy("Recuperação completa", 8),
      { label: "TESTE 2 — 200m", duration_min: 3.5, target: "Máximo" },
      easy("Volta à calma 200m", 6),
    ],
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
