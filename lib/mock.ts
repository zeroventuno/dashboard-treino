import type {
  Checkin, DailyMeal, DashboardData, InjuryEntry, NutritionRule, Phase, PerformanceIndicators,
  PerformanceMilestone, StrengthSession, TrainingLoad, Workout,
} from "./types";
import { addDays, startOfWeek, toISO } from "./utils";

/** Deterministic PRNG so mock data is stable between renders. */
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TODAY = new Date(2026, 6, 4); // 2026-07-04 (matches mock "now")

/** Build a plausible ~110-day PMC series ending today. */
function buildTrainingLoad(): TrainingLoad[] {
  const rnd = mulberry32(21);
  const days = 112;
  const start = addDays(TODAY, -(days - 1));
  const out: TrainingLoad[] = [];
  let ctl = 42, atl = 40;

  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    const dow = (d.getDay() + 6) % 7; // 0 = Mon
    const weekIdx = Math.floor(i / 7);
    const recoveryWeek = weekIdx % 4 === 3; // every 4th week lighter
    // ramping base load through the season
    const ramp = 55 + i * 0.28;

    let tss = 0;
    if (dow === 0) tss = 0; // Monday rest
    else if (dow === 2 || dow === 4) tss = ramp * (0.7 + rnd() * 0.3); // quality
    else if (dow === 5) tss = ramp * (1.4 + rnd() * 0.5); // long day
    else if (dow === 6) tss = ramp * (0.9 + rnd() * 0.4); // long-2
    else tss = ramp * (0.5 + rnd() * 0.35);
    if (recoveryWeek) tss *= 0.6;
    tss = Math.round(tss);

    const tsb = ctl - atl;
    ctl = ctl + (tss - ctl) / 42;
    atl = atl + (tss - atl) / 7;

    out.push({
      date: toISO(d),
      tss,
      ctl: +ctl.toFixed(1),
      atl: +atl.toFixed(1),
      tsb: +tsb.toFixed(1),
      source: "garmin",
    });
  }
  return out;
}

const SAMPLE_ZWO = `<workout_file>
  <author>Coach Claude</author>
  <name>Bike — Sweet Spot 3x12'</name>
  <description>Aquecimento progressivo, 3x12' em sweet spot (88-93% FTP) com 5' fácil entre blocos.</description>
  <sportType>bike</sportType>
  <workout>
    <Warmup Duration="600" PowerLow="0.45" PowerHigh="0.7"/>
    <SteadyState Duration="720" Power="0.90"/>
    <SteadyState Duration="300" Power="0.55"/>
    <SteadyState Duration="720" Power="0.90"/>
    <SteadyState Duration="300" Power="0.55"/>
    <SteadyState Duration="720" Power="0.90"/>
    <Cooldown Duration="480" PowerLow="0.6" PowerHigh="0.4"/>
  </workout>
</workout_file>`;

/** Workouts for the current week (Mon–Sun containing TODAY). */
function buildWeekWorkouts(): Workout[] {
  const mon = startOfWeek(TODAY);
  const d = (n: number) => toISO(addDays(mon, n));
  return [
    {
      id: "w1", date: d(0), discipline: "swim", title: "Natação — Técnica + CSS",
      description: "Foco em rolamento e catch.\n\n- 400m aquecimento variado\n- 8x50m drills (pull buoy / catch-up)\n- 6x100m no ritmo CSS c/ 15\" descanso\n- 200m solto",
      garmin_instructions: "1. Criar treino de natação em piscina (25m)\n2. Aquecimento: 400m\n3. Drill: 8 x 50m, descanso 20\"\n4. Principal: 6 x 100m @ CSS, descanso 15\"\n5. Volta à calma: 200m",
      zwo_content: null, status: "done", planned_duration_min: 50, planned_tss: 45, actual_tss: 47, notes: "Senti o catch mais firme.", nutrition_notes: null, created_at: "",
    },
    {
      id: "w2", date: d(1), discipline: "bike", title: "Bike — Sweet Spot 3x12'",
      description: "Bloco de sweet spot para construir resistência de limiar.\n\n- 10' aquecimento progressivo\n- 3x12' @ 88-93% FTP, 5' fácil entre\n- 8' volta à calma",
      garmin_instructions: "1. Novo treino de ciclismo (por potência)\n2. Aquecimento 10' subindo até Z2\n3. Repetir 3x: 12' @ 220-230W, 5' @ 130W\n4. Volta à calma 8'",
      zwo_content: SAMPLE_ZWO, status: "done", planned_duration_min: 70, planned_tss: 78, actual_tss: 80, notes: null,
      nutrition_notes: "MÉDIO: Água 500ml + banana 30-45min antes. Durante: água pura se <60min. Pós: whey (25-30g) + carboidrato dentro de 30min.",
      created_at: "",
    },
    {
      id: "w3", date: d(2), discipline: "run", title: "Corrida — Intervalos de limiar",
      description: "Trabalho de limiar aeróbio.\n\n- 15' fácil\n- 5x1km @ pace de limiar (4:20/km) c/ 90\" trote\n- 10' solto",
      garmin_instructions: "1. Novo treino de corrida\n2. Aquecimento 15'\n3. Repetir 5x: 1km @ 4:20/km, recuperação 90\" trote\n4. Volta à calma 10'",
      zwo_content: null, status: "done", planned_duration_min: 55, planned_tss: 62, actual_tss: 58, notes: "Pace bom, FC controlada.", nutrition_notes: null, created_at: "",
    },
    {
      id: "w4", date: d(3), discipline: "strength", title: "Força — Membros inferiores + core",
      description: "Circuito de força funcional.\n\n- Agachamento 4x8\n- Afundo búlgaro 3x10/perna\n- Stiff 3x10\n- Prancha 3x45\"\n- Elevação de panturrilha 3x15",
      garmin_instructions: "Sessão livre — registrar como musculação no relógio.",
      zwo_content: null, status: "done", planned_duration_min: 45, planned_tss: 25, actual_tss: 25, notes: null, nutrition_notes: null, created_at: "",
    },
    {
      id: "w5", date: d(4), discipline: "swim", title: "Natação — Resistência",
      description: "Volume aeróbio contínuo.\n\n- 300m aquecimento\n- 3x400m ritmo constante c/ 30\" descanso\n- 100m solto",
      garmin_instructions: "1. Aquecimento 300m\n2. 3 x 400m @ ritmo constante, 30\" descanso\n3. Solto 100m",
      zwo_content: null, status: "planned", planned_duration_min: 50, planned_tss: 42, actual_tss: null, notes: null, nutrition_notes: null, created_at: "",
    },
    {
      id: "w6", date: d(5), discipline: "bike", title: "Bike longo — Endurance Z2",
      description: "Rodagem longa aeróbia com blocos de cadência.\n\n- 2h30 em Z2 estável\n- 4x5' em cadência alta (100+ rpm)\n- Nutrição de prova: 60-80g CHO/h",
      garmin_instructions: "1. Treino por potência/FC\n2. Manter 150-170W (Z2) por 2h30\n3. A cada 30': 5' cadência 100+ rpm\n4. Praticar hidratação e gel",
      zwo_content: null, status: "planned", planned_duration_min: 150, planned_tss: 135, actual_tss: null, notes: null,
      nutrition_notes: "LONGO: Água + carbo leve 1-2h antes. Durante: hydration drink (30-60g carbo/h), gel ou banana a cada 45-60min. Pós: whey + refeição completa + magnésio.",
      created_at: "",
    },
    {
      id: "w7", date: d(6), discipline: "run", title: "Corrida longa — Progressiva",
      description: "Longão progressivo terminando em ritmo de prova.\n\n- 70' começando fácil (5:10/km)\n- Últimos 20' @ ritmo de prova (4:45/km)",
      garmin_instructions: "1. Novo treino de corrida\n2. 70' @ 5:10/km\n3. 20' finais @ 4:45/km",
      zwo_content: null, status: "planned", planned_duration_min: 90, planned_tss: 88, actual_tss: null, notes: null,
      nutrition_notes: "MÉDIO: Água 500ml + banana 30-45min antes. Durante: água pura (ou eletrólitos se calor). Pós: whey (25-30g) + carboidrato dentro de 30min.",
      created_at: "",
    },
  ];
}

const phases: Phase[] = [
  { id: "p1", name: "Base",  start_date: "2026-05-01", end_date: "2026-07-31", focus: "Base aeróbia, técnica de nado e força", color: "#2dd4bf" },
  { id: "p2", name: "Build", start_date: "2026-08-01", end_date: "2026-09-27", focus: "Limiar e resistência específica de prova", color: "#c6f24e" },
  { id: "p3", name: "Peak",  start_date: "2026-09-28", end_date: "2026-10-11", focus: "Intensidade de prova, afiamento", color: "#f4a24e" },
  { id: "p4", name: "Taper", start_date: "2026-10-12", end_date: "2026-10-24", focus: "Redução de volume, frescor", color: "#4fb8ff" },
  { id: "p5", name: "Race",  start_date: "2026-10-25", end_date: "2026-10-25", focus: "Dia da prova — Costa Navarino", color: "#ff5f57" },
];

const milestones: PerformanceMilestone[] = [
  { id: "m1", date: "2026-05-15", metric: "FTP", value: 232, unit: "W", notes: "Teste de rampa" },
  { id: "m2", date: "2026-06-20", metric: "FTP", value: 245, unit: "W", notes: "20' test — +13W" },
  { id: "m3", date: "2026-06-10", metric: "swim_pace_100m", value: 1.72, unit: "min/100m", notes: "Teste CSS 400/200" },
  { id: "m4", date: "2026-08-16", metric: "prova_prep", value: 0, unit: "Olímpico", notes: "Triatlo olímpico de preparação" },
  { id: "m5", date: "2026-09-13", metric: "run_pace_threshold", value: 4.33, unit: "min/km", notes: "Teste de limiar de corrida" },
  { id: "m6", date: "2026-10-04", metric: "prova_prep", value: 0, unit: "Meia maratona", notes: "Rehearsal de ritmo" },
];

const indicators: PerformanceIndicators = {
  id: "pi1",
  updated_at: "2026-06-28T10:00:00Z",
  ftp_watts: 245,
  bike_zones: {
    "Z1 Recuperação": [0, 135],
    "Z2 Endurance": [136, 183],
    "Z3 Tempo": [184, 220],
    "Z4 Limiar": [221, 257],
    "Z5 VO2": [258, 306],
  },
  run_pace_zones: {
    "Z1 Fácil": "5:30–5:05",
    "Z2 Endurance": "5:05–4:45",
    "Z3 Tempo": "4:45–4:30",
    "Z4 Limiar": "4:30–4:15",
    "Z5 VO2": "4:15–3:55",
  },
  swim_pace_per_100m: "1:42",
  run_threshold_pace: "4:20",
  cadence_run_target: 182,
  hr_zones: {
    "Z1": [95, 128],
    "Z2": [129, 145],
    "Z3": [146, 158],
    "Z4": [159, 170],
    "Z5": [171, 186],
  },
};

function buildStrength(): StrengthSession[] {
  const d = (n: number) => toISO(addDays(TODAY, n));
  return [
    { id: "s1", date: d(-1), muscle_groups: ["quadriceps", "glutes", "hamstrings", "core", "calves"],
      exercises: [
        { name: "Agachamento", sets: 4, reps: "8", load: "80kg" },
        { name: "Afundo búlgaro", sets: 3, reps: "10/perna", load: "16kg" },
        { name: "Stiff", sets: 3, reps: "10", load: "60kg" },
        { name: "Panturrilha em pé", sets: 3, reps: "15", load: "corpo" },
      ], notes: "Boa ativação de glúteo." },
    { id: "s2", date: d(-4), muscle_groups: ["core", "shoulders", "back"],
      exercises: [
        { name: "Prancha", sets: 3, reps: "45\"" },
        { name: "Remada", sets: 4, reps: "10", load: "22kg" },
        { name: "Desenvolvimento", sets: 3, reps: "12", load: "14kg" },
      ], notes: null },
    { id: "s3", date: d(-6), muscle_groups: ["quadriceps", "glutes", "core"],
      exercises: [{ name: "Leg press", sets: 4, reps: "12", load: "160kg" }], notes: null },
  ];
}

function buildCheckins(): Checkin[] {
  const rnd = mulberry32(7);
  const out: Checkin[] = [];
  for (let i = 12; i >= 0; i--) {
    const date = toISO(addDays(TODAY, -i));
    const hrv = Math.round(58 + rnd() * 26);
    const sleep = +(6.6 + rnd() * 1.8).toFixed(1);
    const readiness = Math.round(50 + rnd() * 45);
    const rec = readiness >= 75 ? "green" : readiness >= 58 ? "yellow" : "red";
    // hydration/protein only logged on some days — mirrors real usage (nulls skipped in averages)
    const hasNutritionLog = i <= 4;
    out.push({
      date, hrv, sleep_hours: sleep, readiness_score: readiness,
      body_battery: Math.round(45 + rnd() * 50), resting_hr: Math.round(46 + rnd() * 7),
      recommendation: rec, notes: i === 0 ? "Boa noite de sono, pronto para o longão." : null,
      hydration_liters: hasNutritionLog ? +(1.8 + rnd() * 1.4).toFixed(1) : null,
      whey_shakes: hasNutritionLog ? Math.round(rnd() * 2) : null,
      protein_grams_estimate: hasNutritionLog ? Math.round(95 + rnd() * 45) : null,
    });
  }
  return out;
}

const bodyComposition = [
  { date: "2026-05-18", weight_kg: 63.9, muscle_mass_kg: 32.6, body_fat_pct: 15.6, lean_mass_kg: 53.9, visceral_fat: 6, metabolic_age: 28, notes: null },
  { date: "2026-06-01", weight_kg: 63.4, muscle_mass_kg: 32.9, body_fat_pct: 15.0, lean_mass_kg: 53.9, visceral_fat: 6, metabolic_age: 27, notes: null },
  { date: "2026-06-15", weight_kg: 63.1, muscle_mass_kg: 33.2, body_fat_pct: 14.4, lean_mass_kg: 54.1, visceral_fat: 5, metabolic_age: 27, notes: null },
  { date: "2026-06-30", weight_kg: 62.9, muscle_mass_kg: 33.5, body_fat_pct: 13.9, lean_mass_kg: 54.2, visceral_fat: 5, metabolic_age: 26, notes: null },
];

const mealPlan: DailyMeal[] = [
  { id: "meal1", meal_order: 1, meal_name: "Café da manhã", time_suggestion: "07:00",
    foods: "Aveia 60g + leite ou bebida vegetal\n2-3 ovos mexidos ou cozidos\n1 fruta (banana ou maçã)\nCafé com canela + cacau puro",
    protein_g: 35, carbs_g: 55, notes: "Canela + cacau ajudam controle glicêmico." },
  { id: "meal2", meal_order: 2, meal_name: "Pré-treino", time_suggestion: "11:00",
    foods: "1 fatia pão integral + requeijão\n1 banana pequena\n500ml água + eletrólitos",
    protein_g: 8, carbs_g: 40, notes: "30-45min antes do treino do meio-dia." },
  { id: "meal3", meal_order: 3, meal_name: "Almoço / Pós-treino", time_suggestion: "13:30",
    foods: "150g frango, peru ou carne magra\n150g arroz, massa ou batata\nLegumes à vontade\nWhey se a refeição ficar com proteína baixa",
    protein_g: 50, carbs_g: 80, notes: "Refeição principal de recuperação." },
  { id: "meal4", meal_order: 4, meal_name: "Lanche", time_suggestion: "16:30",
    foods: "Queijo + fruta ou iogurte grego\nPunhado de oleaginosas",
    protein_g: 20, carbs_g: 15, notes: "Serve de pré-treino leve se treinar à tarde." },
  { id: "meal5", meal_order: 5, meal_name: "Jantar", time_suggestion: "20:00",
    foods: "Salada ou sopa como base\nProteína: frango, carne, ovos, leguminosas\nCarboidrato leve ou nenhum se não treinou",
    protein_g: 35, carbs_g: 30, notes: null },
];

const nutritionRules: NutritionRule[] = [
  { id: "nr1", duration_category: "curto", duration_range: "< 45min", discipline_context: "Força, natação curta, corrida leve",
    before_training: "Água. Nada sólido necessário.", during_training: "Nada ou água à vontade.",
    after_training: "Água + refeição normal na próxima janela.", supplements_used: ["água"], notes: null },
  { id: "nr2", duration_category: "medio", duration_range: "45-90min", discipline_context: "Bike Z2, corrida 30-60min, natação 2000m+",
    before_training: "Água 500ml + banana 30-45min antes.", during_training: "Água pura se <60min; eletrólitos se calor/>60min.",
    after_training: "Whey (25-30g) + carboidrato dentro de 30min.", supplements_used: ["whey protein"], notes: null },
  { id: "nr3", duration_category: "longo", duration_range: "90-150min", discipline_context: "Long ride, brick, corrida longa",
    before_training: "Água + carbo leve 1-2h antes.", during_training: "Hydration drink: 30-60g carbo/h + gel/banana a cada 45-60min.",
    after_training: "Whey + refeição completa + magnésio.", supplements_used: ["hydration drink", "whey protein", "magnésio"], notes: "Praticar estratégia de prova." },
  { id: "nr4", duration_category: "muito_longo", duration_range: "> 150min", discipline_context: "Simulações de prova, fase Build/Peak",
    before_training: "Café da manhã completo 2-3h antes.", during_training: "Hydration drink constante + gel/banana a cada 45min + eletrólitos.",
    after_training: "Whey + refeição rica + eletrólitos + magnésio.", supplements_used: ["hydration drink", "whey protein", "magnésio", "gel"], notes: "Calibrar nutrição de prova." },
];

const injuries: InjuryEntry[] = [
  { id: "i1", date: "2026-06-30", area: "left_knee", severity: 2, notes: "Leve desconforto patelar após bike longa. Alongamento + fortalecimento VMO." },
  { id: "i2", date: "2026-06-22", area: "right_calf", severity: 1, notes: "Rigidez na panturrilha, melhorou com liberação miofascial." },
  { id: "i3", date: "2026-06-05", area: "left_hip_sciatic", severity: 3, notes: "Ciático irritado após corrida longa. Reduzido volume por 4 dias." },
];

export function getMockData(): DashboardData {
  return {
    trainingLoad: buildTrainingLoad(),
    workouts: buildWeekWorkouts(),
    phases,
    milestones,
    indicators,
    strength: buildStrength(),
    checkins: buildCheckins(),
    injuries,
    bodyComposition,
    mealPlan,
    nutritionRules,
  };
}
