// FitActivity -> ImportedFitWorkout mapping. Rode com:  npx tsx product/tests/fit-parse.ts
import { toWorkout, type FitActivity } from "../../lib/fit-parse";

let fail = 0;
const ck = (l: string, c: boolean, e = "") => {
  if (!c) { fail++; console.log("FAIL  " + l + (e ? "  → " + e : "")); }
  else console.log("ok    " + l);
};

const base: FitActivity = {
  externalId: "fit:1:2:3", startISO: "2026-08-19T10:00:00.000Z", date: "2026-08-19",
  discipline: "run", sport: 1, timerSeconds: 1800, distanceM: 6000, calories: 500,
  avgHeartRate: 150, maxHeartRate: 170, avgPower: null, maxPower: null,
  normalizedPower: null, avgCadence: 170, avgSpeedMS: 3.33, ascentM: 20,
  laps: [], samples: [], dynamics: null,
};

// ── Corrida: distância + pace em /km, sem potência ──────────────────────────
const run = toWorkout(base);
ck("run: mantém external_id/date/discipline", run?.external_id === "fit:1:2:3" && run?.date === "2026-08-19" && run?.discipline === "run");
ck("run: duração em minutos", run?.actual_duration_min === 30);
ck("run: distância em km", run?.actual_distance_km === 6);
ck("run: pace em /km (5:00/km para 6km em 30min)", run?.actual_pace === "5:00/km", String(run?.actual_pace));
ck("run: sem potência", run?.actual_power_watts === null);

// ── Natação: pace em /100m ───────────────────────────────────────────────────
const swim = toWorkout({ ...base, discipline: "swim", sport: 5, distanceM: 2000, timerSeconds: 2400 });
ck("swim: pace em /100m (2:00/100m para 2000m em 40min)", swim?.actual_pace === "2:00/100m", String(swim?.actual_pace));

// ── Bike: potência, nunca pace ────────────────────────────────────────────────
const bike = toWorkout({ ...base, discipline: "bike", sport: 2, avgPower: 187.4 });
ck("bike: sem pace", bike?.actual_pace === null);
ck("bike: potência arredondada com W", bike?.actual_power_watts === "187W", String(bike?.actual_power_watts));

// ── Sem distância: sem pace, distância nula, não quebra ──────────────────────
const noDist = toWorkout({ ...base, distanceM: null });
ck("sem distância: actual_distance_km nulo", noDist?.actual_distance_km === null);
ck("sem distância: sem pace", noDist?.actual_pace === null);

// ── Modalidade não reconhecida: refuse, não filed errado ─────────────────────
const unknown = toWorkout({ ...base, discipline: null, sport: 99 });
ck("modalidade desconhecida: retorna null", unknown === null);

console.log(fail ? `\n${fail} falha(s)` : "\ntudo certo");
process.exit(fail ? 1 : 0);
