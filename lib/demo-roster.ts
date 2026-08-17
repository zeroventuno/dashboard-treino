// ────────────────────────────────────────────────────────────────────────────
//  TEST BED — the fixed cohort /coach/demo renders. NOT sample data.
//
//  Read this before changing a number below.
//
//  These nine athletes do not exist and are never presented as if they did. The
//  module writes nothing, reads nothing, and touches no database: it is a set of
//  literals shaped exactly like the rows app.roster_summary / app.roster_planned_ahead
//  / app.roster_test_dates return, so /coach/demo can drive the SAME RosterBoard
//  the real /coach drives and any difference on screen is a difference in the
//  component, never in the data path.
//
//  Its purpose is to be JUDGED against. Every profile here was chosen to put one
//  state of the panel on screen at realistic volume — an empty calendar, a
//  fortnight of silence, an overtrained athlete still checking in daily — so that
//  work on the roster can be evaluated on a cohort that behaves like a real book
//  instead of on two happy-path cards. The mix is documented per athlete below;
//  if you add or edit one, keep the mix intact or the test bed stops testing.
//
//  The demo page is a public preview, so the fiction has to stay obviously
//  fiction: names are invented, the page labels the data as fictional, and no
//  figure here should ever be quoted as a real client's result.
// ────────────────────────────────────────────────────────────────────────────

import type { RosterAthlete, RosterPlanAhead } from "./product-db";
import type { AttentionRow } from "./retention";
import type { RosterLoadSummary } from "./roster-load";
import type { PerformanceMilestone } from "./types";
import { needsTesting, testStatus, type TestStatus } from "./testing";
import { addDays, toISO } from "./utils";

/** The three threshold dates app.roster_test_dates returns per athlete. */
interface DemoTestDates {
  ftp_at: string | null;
  run_at: string | null;
  swim_at: string | null;
}

/** One fictional athlete, in every shape the panel reads them in. Bundled rather
 * than kept in four parallel lists so a profile stays coherent when edited: the
 * athlete with nothing on the calendar is the same one whose completed-session
 * count collapsed, because that is what an empty calendar does. */
export interface DemoAthlete {
  /** One-line description of the state this athlete exists to exercise. */
  profile: string;
  roster: RosterAthlete;
  plan: RosterPlanAhead;
  tests: DemoTestDates;
  /** For the retention/attention screens (lib/retention.ts) — the facts that
   * RosterAthlete has no room for: account age, and sessions completed in the
   * last fortnight against the fortnight before. */
  attention: AttentionRow;
  /** PMC facts for lib/roster-load.ts. Readiness is what the athlete SAYS today;
   * this is what the training actually did to them, and the overtraining
   * profiles need both halves to be worth testing against. The cohort covers
   * every branch of classifyLoad on purpose, including the two that must return
   * null — an athlete gone dormant (Gonçalo) and too little history to trust
   * (Sofía) — because failing to silence is the failure that matters there.
   *
   * These are SUMMARIES of a derived curve, not stored rows: in the live panel
   * getRosterLoad builds each athlete's PMC with the same extendCurve the
   * athlete's own chart uses, then reduces it with summarizeCurve. The literals
   * below stand in for that output. */
  load: RosterLoadSummary;
}

const COACH = "Rui Beltrão";

/**
 * The cohort, dated relative to `today` so countdowns and "check-in Nd ago" stay
 * live rather than rotting into negative numbers next month.
 *
 * Phase spread: Base 3 · Build 2 · Peak 2 · Taper 1 · no cycle 1 — a real book
 * skews to the early phases, and the no-cycle group has to be populated too
 * because that is where a newly onboarded athlete lands.
 */
export function demoCohort(today = new Date()): DemoAthlete[] {
  const ago = (n: number) => toISO(addDays(today, -n));
  const ahead = (n: number) => toISO(addDays(today, n));

  const make = (
    id: string,
    profile: string,
    roster: Omit<RosterAthlete, "tenant_id">,
    plan: Omit<RosterPlanAhead, "tenant_id">,
    tests: Partial<DemoTestDates>,
    attention: Omit<AttentionRow, "tenant_id" | "name" | "email" | "staff" | "staff_ids">,
    load: Omit<RosterLoadSummary, "tenant_id">,
  ): DemoAthlete => ({
    profile,
    roster: { tenant_id: id, ...roster },
    plan: { tenant_id: id, ...plan },
    tests: { ftp_at: null, run_at: null, swim_at: null, ...tests },
    attention: {
      tenant_id: id,
      name: roster.name,
      email: `${id}@exemplo.invalid`, // .invalid is reserved by RFC 2606 — cannot resolve
      staff: [COACH],
      staff_ids: ["s1"],
      ...attention,
    },
    load: { tenant_id: id, ...load },
  });

  return [
    // ── 1 of 2 fully consistent: the athlete everything else is read against.
    make(
      "d1",
      "Consistente — check-in diário, verde, plano cheio, adesão alta",
      {
        name: "Marina Salgueiro",
        athlete: "Marina Salgueiro",
        mode: "race",
        current_phase: "Base",
        sports: ["swim", "bike", "run", "strength"],
        metrics: ["power", "hrv", "bioimpedance"],
        next_race_name: "IRONMAN 70.3 Cascais",
        next_race_date: ahead(96),
        today_reco: "green",
        last_checkin: ago(0),
        recent_injuries: 0,
        injury_severity: null,
      },
      { planned_7d: 6, planned_14d: 12, last_planned: ahead(21) },
      { ftp_at: ago(18), run_at: ago(25), swim_at: ago(11) },
      {
        created_at: ago(430), last_checkin: ago(0), last_done: ago(1),
        done_recent: 11, done_prev: 12, checkins_recent: 14, monthly_value: "320.00",
      },
      // Productive load, steady: TSB deep in the training band but barely moving,
      // so `rising` is false and the level stays "ok". A Base block is SUPPOSED
      // to look like this, and a panel that flagged it would be noise.
      {
        load_date: ago(0), ctl: 72, atl: 86, tsb: -14,
        prev_date: ago(7), prev_tsb: -12, history_days: 180, sessions_42d: 24,
      },
    ),

    // ── 2 of 2 fully consistent, different sport mix (no swim) so the modality
    //    icons are not identical across the two green cards.
    make(
      "d2",
      "Consistente — ciclista/corredor, verde, plano cheio, sem natação",
      {
        name: "Íñigo Berasategui",
        athlete: "Íñigo",
        mode: "race",
        current_phase: "Build",
        sports: ["bike", "run", "strength"],
        metrics: ["power", "hrv"],
        next_race_name: "IRONMAN 70.3 Vitoria-Gasteiz",
        next_race_date: ahead(55),
        today_reco: "green",
        last_checkin: ago(0),
        recent_injuries: 0,
        injury_severity: null,
      },
      { planned_7d: 5, planned_14d: 11, last_planned: ahead(17) },
      { ftp_at: ago(20), run_at: ago(27) },
      {
        created_at: ago(281), last_checkin: ago(0), last_done: ago(1),
        done_recent: 10, done_prev: 10, checkins_recent: 13, monthly_value: "260.00",
      },
      {
        load_date: ago(0), ctl: 65, atl: 73, tsb: -8,
        prev_date: ago(7), prev_tsb: -7, history_days: 180, sessions_42d: 21,
      },
    ),

    // ── Gap 1 of 2: five days quiet. Still training — the silence is in the
    //    check-ins, which is why no readiness light is computed for today.
    make(
      "d3",
      "Silêncio curto — 5 dias sem check-in, treinando, sem farol hoje",
      {
        name: "Chiara Bellandi",
        athlete: "Chiara Bellandi",
        mode: "race",
        current_phase: "Peak",
        sports: ["swim", "bike", "run"],
        metrics: ["hrv", "bioimpedance"],
        next_race_name: "IRONMAN Italy Emilia-Romagna",
        next_race_date: ahead(21),
        today_reco: null,
        last_checkin: ago(5),
        recent_injuries: 0,
        injury_severity: null,
      },
      { planned_7d: 6, planned_14d: 11, last_planned: ahead(18) },
      { ftp_at: ago(31), run_at: ago(38), swim_at: ago(44) },
      {
        created_at: ago(190), last_checkin: ago(5), last_done: ago(1),
        done_recent: 9, done_prev: 10, checkins_recent: 3, monthly_value: "240.00",
      },
      // "watch": already carrying load and TSB fell 12 points in a week. The only
      // athlete in the cohort whose fatigue is visible ONLY in the load reading —
      // she reports nothing, because she stopped checking in.
      {
        load_date: ago(1), ctl: 70, atl: 86, tsb: -16,
        prev_date: ago(8), prev_tsb: -4, history_days: 180, sessions_42d: 19,
      },
    ),

    // ── Gap 2 of 2: eighteen days. Past the point where a check-in reminder is
    //    the answer, and the plan has been allowed to run out behind it.
    //    `athlete` is null on purpose: the card must fall back to `name`.
    make(
      "d4",
      "Silêncio longo — 18 dias sem check-in, plano acabando, sem perfil preenchido",
      {
        name: "Gonçalo Vasconcelos",
        athlete: null,
        mode: "race",
        current_phase: "Base",
        sports: ["run", "strength"],
        metrics: [],
        next_race_name: "Maratona do Porto",
        next_race_date: ahead(88),
        today_reco: null,
        last_checkin: ago(18),
        recent_injuries: 0,
        injury_severity: null,
      },
      // 7d > 0 but 14d <= 2 → the quiet "plan runs out in days" warning.
      { planned_7d: 2, planned_14d: 2, last_planned: ahead(3) },
      { run_at: ago(96) },
      {
        created_at: ago(220), last_checkin: ago(18), last_done: ago(12),
        done_recent: 1, done_prev: 8, checkins_recent: 0, monthly_value: "180.00",
      },
      // GATE: four sessions in six weeks, under MIN_SESSIONS_42D, so classifyLoad
      // must return null. He has essentially stopped, and his curve is decaying
      // towards fresh — reporting that as a green load reading would say the
      // opposite of what happened. "He stopped training" is a retention signal,
      // and lib/retention already owns it (done_prev 8 → done_recent 1).
      //
      // Note this fires on session count, NOT on staleness: the curve is derived
      // and always runs to today, so a reading can no longer go stale in the live
      // path. MAX_STALE_DAYS is a defensive gate now, exercised only in the unit
      // tests.
      {
        load_date: ago(0), ctl: 24, atl: 12, tsb: 12,
        prev_date: ago(7), prev_tsb: 6, history_days: 180, sessions_42d: 4,
      },
    ),

    // ── Overtraining 1 of 2. The dangerous shape: engagement is perfect (checks
    //    in every day, full calendar) while the work completed halved. Nothing
    //    about this athlete looks like churn — the signal is only the red light
    //    plus done_prev 12 → done_recent 5.
    make(
      "d5",
      "Sobrecarga — farol vermelho, check-in diário, sessões concluídas caindo pela metade",
      {
        name: "Renato Cabral",
        athlete: "Renato Cabral",
        mode: "race",
        current_phase: "Build",
        sports: ["swim", "bike", "run"],
        metrics: ["power", "hrv"],
        next_race_name: "IRONMAN Brasil Florianópolis",
        next_race_date: ahead(34),
        today_reco: "red",
        last_checkin: ago(0),
        recent_injuries: 1,
        injury_severity: 2, // the niggle that shows up under sustained fatigue
      },
      { planned_7d: 6, planned_14d: 13, last_planned: ahead(24) },
      { ftp_at: ago(47), run_at: ago(19), swim_at: ago(26) },
      {
        created_at: ago(500), last_checkin: ago(0), last_done: ago(2),
        done_recent: 5, done_prev: 12, checkins_recent: 13, monthly_value: "340.00",
      },
      // "overreaching": TSB below the high-fatigue band (−25) AND falling 16
      // points in a week. The red light and the PMC agree — which is what a clear
      // overtraining case looks like, and the case any load column has to catch.
      {
        load_date: ago(1), ctl: 84, atl: 118, tsb: -34,
        prev_date: ago(8), prev_tsb: -18, history_days: 180, sessions_42d: 17,
      },
    ),

    // ── Overtraining 2 of 2, sixteen days from a race — the same signal with a
    //    deadline attached, so the two red cards are not interchangeable.
    make(
      "d6",
      "Sobrecarga perto da prova — vermelho no Peak, 16 dias para a largada",
      {
        name: "Valentina Moretti",
        athlete: "Vale",
        mode: "race",
        current_phase: "Peak",
        sports: ["swim", "bike", "run", "strength"],
        metrics: ["power", "hrv", "bioimpedance"],
        next_race_name: "IRONMAN 70.3 Cervia",
        next_race_date: ahead(16),
        today_reco: "red",
        last_checkin: ago(1),
        recent_injuries: 0,
        injury_severity: null,
      },
      { planned_7d: 5, planned_14d: 9, last_planned: ahead(15) },
      { ftp_at: ago(22), run_at: ago(29), swim_at: ago(33) },
      {
        created_at: ago(365), last_checkin: ago(1), last_done: ago(2),
        done_recent: 6, done_prev: 14, checkins_recent: 11, monthly_value: "300.00",
      },
      // "overreaching" two weeks out from a race — the taper has not started and
      // the hole is still being dug.
      {
        load_date: ago(1), ctl: 78, atl: 109.5, tsb: -31.5,
        prev_date: ago(8), prev_tsb: -12, history_days: 180, sessions_42d: 20,
      },
    ),

    // ── The empty calendar. planned_7d = 0 is the one state RosterBoard ranks
    //    ABOVE a red light, and the card carries a loud "sem treino na semana".
    //    Deliberately paired with a green light and a daily check-in: this
    //    athlete is doing everything right and receiving nothing, which is
    //    exactly why the state must be visible from across the grid.
    make(
      "d7",
      "Calendário VAZIO — planned_7d = 0, atleta engajado, nada escrito há 26 dias",
      {
        name: "Diogo Nunes",
        athlete: "Diogo Nunes",
        mode: "race",
        current_phase: "Base",
        sports: ["bike", "run"],
        metrics: ["power"],
        next_race_name: "Meia Maratona de Lisboa",
        next_race_date: ahead(47),
        today_reco: "green",
        last_checkin: ago(0),
        recent_injuries: 0,
        injury_severity: null,
      },
      { planned_7d: 0, planned_14d: 0, last_planned: ago(26) },
      { ftp_at: ago(58), run_at: ago(63) },
      {
        created_at: ago(150), last_checkin: ago(0), last_done: ago(11),
        done_recent: 2, done_prev: 9, checkins_recent: 12, monthly_value: "220.00",
      },
      // Fresh, and not on purpose: TSB climbing because nothing is being asked of
      // him. isFresh() is true here for the opposite reason it is true for Bruno,
      // which is the pair worth testing any "fresh" treatment against.
      {
        load_date: ago(2), ctl: 41, atl: 27, tsb: 14,
        prev_date: ago(9), prev_tsb: 4, history_days: 150, sessions_42d: 11,
      },
    ),

    // ── Brand new: six days old, no cycle, no race, no threshold ever measured,
    //    and only the first few days written. `monthly_value: null` also puts an
    //    unpriced athlete in the cohort, which the agency totals count separately.
    make(
      "d8",
      "Recém-chegada — conta com 6 dias, sem ciclo, sem prova, nunca testada",
      {
        name: "Sofía Ibáñez",
        athlete: "Sofía Ibáñez",
        mode: "cycle",
        current_phase: null,
        sports: ["swim", "run"],
        metrics: [],
        next_race_name: null,
        next_race_date: null,
        today_reco: "yellow",
        last_checkin: ago(1),
        recent_injuries: 0,
        injury_severity: null,
      },
      { planned_7d: 3, planned_14d: 3, last_planned: ahead(2) },
      {}, // never tested in any discipline
      {
        created_at: ago(6), last_checkin: ago(1), last_done: ago(1),
        // done_prev is 0 because that fortnight predates the account existing.
        done_recent: 3, done_prev: 0, checkins_recent: 5, monthly_value: null,
      },
      // GATE: five days of curve against MIN_HISTORY_DAYS (42), so classifyLoad
      // must return null. Her CTL is still climbing out of the zero it is seeded
      // at on the first session, and the −6 is an artefact of the account being
      // new, not fatigue. She also fails MIN_SESSIONS_42D; either alone silences.
      {
        load_date: ago(1), ctl: 12, atl: 18, tsb: -6,
        prev_date: null, prev_tsb: null, history_days: 5, sessions_42d: 3,
      },
    ),

    // ── The injury, at a severity that changes the plan: 4/5, nine days out,
    //    in taper. sevColor paints this one var(--bad) against Renato's
    //    var(--warn) at 2/5, so the two crosses on the grid are not the same
    //    colour — which is the whole reason severity is on the card.
    make(
      "d9",
      "Lesão relevante — severidade 4/5 a 9 dias da prova, em Taper",
      {
        name: "Bruno Sartori",
        athlete: "Bruno Sartori",
        mode: "race",
        current_phase: "Taper",
        sports: ["swim", "bike", "run"],
        metrics: ["hrv"],
        next_race_name: "Triathlon Alpe d'Huez",
        next_race_date: ahead(9),
        today_reco: "yellow",
        last_checkin: ago(0),
        recent_injuries: 1,
        injury_severity: 4,
      },
      { planned_7d: 4, planned_14d: 5, last_planned: ahead(10) },
      { ftp_at: ago(24), run_at: ago(30), swim_at: ago(36) },
      {
        created_at: ago(320), last_checkin: ago(0), last_done: ago(1),
        done_recent: 7, done_prev: 11, checkins_recent: 14, monthly_value: "280.00",
      },
      // Fresh ON PURPOSE — the taper doing its job, TSB up 22 points in a week.
      // The mirror image of Diogo, and the reason "fresh" can't be reported as
      // good news without knowing which of the two it is.
      //
      // Was +9 while isFresh() read against +5. The boundary is now the chart's
      // own race-ready line (+10, lib/pmc-curve.TSB_NEUTRAL_HIGH) so the roster
      // and the athlete's tooltip agree on who is fresh — and +9 would have
      // quietly stopped being fresh, breaking the pairing this athlete exists
      // for. +16 nine days out is what a real taper looks like anyway.
      {
        load_date: ago(0), ctl: 74, atl: 58, tsb: 16,
        prev_date: ago(7), prev_tsb: -6, history_days: 180, sessions_42d: 18,
      },
    ),
  ];
}

/**
 * Threshold dates → the badge the card shows, through the SAME pipeline
 * app/coach/page.tsx uses (testStatus over bike/run/swim, then needsTesting).
 *
 * Disciplines come from the athlete's declared `sports`, mirroring what
 * app/coach/page.tsx does — empty means "nothing declared", so all three, never
 * "none". This used to copy a hardcoded triad from the page, and when the page
 * was fixed to read `sports` the fixture kept the old behaviour and started
 * showing badges the real panel no longer shows.
 *
 * A test bed that has drifted from the thing it stands in for is worse than no
 * test bed: every measurement taken against it is then a measurement of the
 * fixture. Whatever the panel does, this must do.
 */
export function demoTests(t: DemoTestDates, todayISO: string, sports: string[] = []): TestStatus[] {
  const milestone = (id: string, date: string, metric: string): PerformanceMilestone => ({
    id, date, metric, value: null, unit: null, notes: null,
  });
  const trained = (["bike", "run", "swim"] as const).filter(
    (d) => sports.length === 0 || sports.includes(d),
  );
  return needsTesting(
    testStatus(
      [
        ...(t.ftp_at ? [milestone("f", t.ftp_at, "FTP")] : []),
        ...(t.run_at ? [milestone("r", t.run_at, "run_pace_threshold")] : []),
        ...(t.swim_at ? [milestone("s", t.swim_at, "swim_pace_100m")] : []),
      ],
      trained,
      todayISO,
    ),
  );
}

/** Everything <RosterBoard> needs, assembled once. Keeps the demo page a page.
 *
 * `load` comes out RAW — the same array shape getRosterLoad hands the real
 * panel — rather than pre-classified, so the demo page runs it through the very
 * same viewRosterLoad call app/coach/page.tsx does. A fixture that classified
 * on its own behalf would stop testing the path it stands in for. */
export function demoRosterBoard(todayISO: string, today = new Date()): {
  cohort: DemoAthlete[];
  roster: RosterAthlete[];
  planFor: (tenantId: string) => RosterPlanAhead | null;
  testsFor: (tenantId: string) => TestStatus[];
  load: RosterLoadSummary[];
} {
  const cohort = demoCohort(today);
  const plans = new Map(cohort.map((a) => [a.roster.tenant_id, a.plan]));
  const tests = new Map(
    cohort.map((a) => [a.roster.tenant_id, demoTests(a.tests, todayISO, a.roster.sports ?? [])]),
  );
  return {
    cohort,
    roster: cohort.map((a) => a.roster),
    planFor: (id) => plans.get(id) ?? null,
    testsFor: (id) => tests.get(id) ?? [],
    load: demoLoad(today),
  };
}

/** The same cohort as retention rows, for the attention/retention screens. */
export function demoAttention(today = new Date()): AttentionRow[] {
  return demoCohort(today).map((a) => a.attention);
}

/** The same cohort as PMC summaries, for lib/roster-load.ts — stand-ins for what
 * getRosterLoad derives per athlete. Fed to /coach/demo through demoRosterBoard,
 * so the fixture exercises the load marks and the distribution bar, and read
 * directly by product/tests/roster-load.ts. */
export function demoLoad(today = new Date()): RosterLoadSummary[] {
  return demoCohort(today).map((a) => a.load);
}
