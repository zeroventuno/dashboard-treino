// TRAKR session → COROS scheduled workout. Rules from the live tool schema.
// Rode com:  npx tsx product/tests/coros-workout.ts
import {
  findIdInPlan, fingerprint, hrRange, intensityOf, paceRange, powerRange, saysNotEditable, sectionTypeOf,
  workoutToCourse,
} from "../../lib/coros-workout";
import type { WorkoutBlock } from "../../lib/types";

let fail = 0;
const ck = (l: string, c: boolean, e = "") => {
  if (!c) { fail++; console.log("FAIL  " + l + (e ? "  → " + e : "")); }
  else console.log("ok    " + l);
};

const TODAY = "2026-10-11";
const base = {
  date: "2026-10-14", discipline: "run" as const, status: "planned" as const, title: "Intervalado 6x3'",
  description: "Foco em ritmo de limiar.", planned_duration_min: 50, planned_distance_km: null,
  planned_pace: null, planned_power_watts: null,
};
const blocks: WorkoutBlock[] = [
  { label: "Aquecimento", duration_min: 15, target: "Z1–Z2 leve" },
  { label: "Tiro 3min", duration_min: 3, target: "4:10–4:20/km" },
  { label: "Recuperação", duration_min: 2, target: "trote" },
  { label: "Volta à calma", duration_min: 10 },
];

// ── parsing de alvo: só número vira alvo ────────────────────────────────────
ck("pace: faixa /km em segundos", JSON.stringify(paceRange("4:10–4:20/km")) === "[250,260]");
ck("pace: valor único vira faixa igual", JSON.stringify(paceRange("5:30/km")) === "[330,330]");
ck("pace: /100m (natação) não vira pace de corrida", paceRange("1:53/100m") === null);
ck("FC: '140-150 bpm'", JSON.stringify(hrRange("FC 140-150 bpm")) === "[140,150]");
ck("FC: fora de 30–240 é recusada", hrRange("20 bpm") === null);
ck("potência: '180–200W'", JSON.stringify(powerRange("180–200W")) === "[180,200]");
ck("potência: '+20W a cada minuto' NÃO é alvo", powerRange("+20W a cada minuto, até não sustentar") === null);
ck("zona 'Z2' fica como texto (não chuta)", Object.keys(intensityOf("Z2 aeróbico", 1)).length === 0);
ck("bike não recebe pace (só FC/potência)", Object.keys(intensityOf("4:10/km", 2)).length === 0);
ck("corrida com pace → intensityType 2", JSON.stringify(intensityOf("4:10–4:20/km", 1)) === JSON.stringify({ intensityType: 2, intensityValueStart: 250, intensityValueEnd: 260 }));

// ── tipo de etapa pelas palavras do treinador ───────────────────────────────
ck("etapas: aquecimento/tiro/recuperação/volta à calma",
  [sectionTypeOf("Aquecimento"), sectionTypeOf("Tiro 3min"), sectionTypeOf("Recuperação"), sectionTypeOf("Volta à calma")].join() === "1,2,3,4");
ck("etapas: inglês e italiano", sectionTypeOf("Warm up") === 1 && sectionTypeOf("Cool down") === 4 && sectionTypeOf("Riscaldamento") === 1);

// ── o curso inteiro ─────────────────────────────────────────────────────────
{
  const m = workoutToCourse(base, blocks, TODAY);
  ck("curso: corrida, data yyyyMMdd", m.ok && m.course.sportType === 1 && m.date === "20261014", JSON.stringify(m));
  if (m.ok) {
    ck("curso: 4 etapas por tempo, em segundos inteiros",
      m.course.sections.map((s) => `${s.sectionType}:${s.targetType}:${s.targetValue}`).join() === "1:2:900,2:2:180,3:2:120,4:2:600",
      JSON.stringify(m.course.sections));
    ck("curso: só o tiro tem alvo; 3 etapas ficam como texto", m.textOnly === 3 && m.course.sections[1].intensityType === 2);
    ck("curso: etapa sem alvo NÃO leva campo de intensidade (nem 0)",
      !("intensityType" in m.course.sections[0]) && !("intensityValueStart" in m.course.sections[0]));
    ck("curso: descrição traz o texto do treinador e as etapas", m.course.courseDescription.includes("Foco em ritmo de limiar") && m.course.courseDescription.includes("• Tiro 3min — 3 min — 4:10–4:20/km"));
    ck("curso: sem campos proibidos (dayNo, strengthBodypart)", !("dayNo" in m.course) && !("strengthBodypart" in m.course));
    ck("curso: impressão digital estável", m.hash === workoutToCourse(base, blocks, TODAY).hash && /^[0-9a-f]{8}$/.test(m.hash));
    const changed = workoutToCourse({ ...base, title: "Intervalado 8x3'" }, blocks, TODAY);
    ck("curso: mudou o treino → impressão muda", changed.ok && changed.hash !== m.hash);
  }
}
{
  const long = workoutToCourse({ ...base, title: "x".repeat(150) }, blocks, TODAY);
  ck("nome: no máximo 100 caracteres", long.ok && long.course.courseName.length === 100);
}
{
  const bike = workoutToCourse({ ...base, discipline: "bike", planned_power_watts: "180-200W" }, [], TODAY);
  ck("sem blocos: uma etapa pela duração, com watts", bike.ok && bike.course.sportType === 2 &&
    JSON.stringify(bike.course.sections) === JSON.stringify([{ sectionType: 2, targetType: 2, targetValue: 3000, intensityType: 4, intensityValueStart: 180, intensityValueEnd: 200 }]),
    JSON.stringify(bike));
  const dist = workoutToCourse({ ...base, planned_duration_min: null, planned_distance_km: 10 }, [], TODAY);
  ck("sem blocos e sem duração: por distância em metros", dist.ok && dist.course.sections[0].targetType === 1 && dist.course.sections[0].targetValue === 10000);
}

// ── o que NÃO pode ir ───────────────────────────────────────────────────────
const why = (w: Parameters<typeof workoutToCourse>[0], b: WorkoutBlock[] = blocks) => {
  const m = workoutToCourse(w, b, TODAY);
  return m.ok ? "ok" : m.reason;
};
ck("recusa: natação / musculação", why({ ...base, discipline: "swim" }) === "unsupported_sport" && why({ ...base, discipline: "strength" }) === "unsupported_sport");
ck("recusa: já feito", why({ ...base, status: "done" }) === "not_planned");
ck("recusa: ontem", why({ ...base, date: "2026-10-10" }) === "past");
ck("aceita: hoje e hoje+90", why({ ...base, date: "2026-10-11" }) === "ok" && why({ ...base, date: "2027-01-09" }) === "ok");
ck("recusa: hoje+91", why({ ...base, date: "2027-01-10" }) === "too_far");
ck("recusa: sem blocos, sem duração, sem distância", why({ ...base, planned_duration_min: null }, []) === "no_duration");
ck("blocos de 0 min são ignorados", (() => { const m = workoutToCourse(base, [{ label: "nota", duration_min: 0 }, ...blocks], TODAY); return m.ok && m.course.sections.length === 4; })());

// ── leitura do resultado da COROS ───────────────────────────────────────────
ck("idInPlan: em JSON aninhado", findIdInPlan({ data: { workout: { idInPlan: "481516234200000001" } } }) === "481516234200000001");
ck("idInPlan: em prosa", findIdInPlan("Created workout on 20261014. idInPlan: 481516234200000001") === "481516234200000001");
ck("idInPlan: ausente → null", findIdInPlan("Created.") === null);
ck("editável: 'editable=false' detectado", saysNotEditable("Workout ... editable: false (already completed)") && !saysNotEditable({ editable: true }));
ck("fingerprint: determinística", fingerprint("abc") === fingerprint("abc") && fingerprint("abc") !== fingerprint("abd"));

console.log(fail ? `\n${fail} falha(s)` : "\ntudo certo");
process.exit(fail ? 1 : 0);
