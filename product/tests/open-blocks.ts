// Aquecimento, drills e descanso não são prescrição de intensidade.
// Rode com:  npx tsx product/tests/open-blocks.ts
import { plannedZones, zoneAdherence, type ZoneSeconds } from "../../lib/zone-time";
import { isOpenBlock } from "../../lib/workout-structure";
import type { WorkoutBlock } from "../../lib/types";

let fail = 0;
const ck = (l: string, c: boolean, e = "") => {
  if (!c) { fail++; console.log("FAIL  " + l + (e ? "  → " + e : "")); }
  else console.log("ok    " + l);
};

// ── Vocabulário, nos cinco idiomas ─────────────────────────────────────────
for (const w of ["Aquecimento", "Warm-up", "Riscaldamento", "Calentamiento", "Échauffement"])
  ck(`aquecimento reconhecido: ${w}`, isOpenBlock(w));
for (const w of ["Volta à calma", "Cooldown", "Defaticamento", "Enfriamiento", "Retour au calme"])
  ck(`volta à calma reconhecida: ${w}`, isOpenBlock(w));
for (const w of ["Descanso 1", "Recuperação", "Recovery", "Rest", "Riposo", "Repos", "Pausa"])
  ck(`descanso reconhecido: ${w}`, isOpenBlock(w));
for (const w of ["Técnica / drills", "Drills", "Technique", "Educativos"])
  ck(`técnica reconhecida: ${w}`, isOpenBlock(w));

// O trabalho NÃO pode virar tempo aberto — senão não sobra nada para pontuar.
for (const w of ["Série 1 forte", "4x1km limiar", "Tiros Curtos", "Bloco VO2", "Endurance 80/20", "Sweet Spot"])
  ck(`trabalho continua sendo trabalho: ${w}`, !isOpenBlock(w));
ck("rótulo vazio não é bloco aberto", !isOpenBlock(""));
ck("rótulo nulo não quebra", !isOpenBlock(null));

// ── A natação do Rafael ────────────────────────────────────────────────────
// 40min prescritos: aquecimento 300m, drills 200m, 4 séries de 150m @ CSS+3s
// com descansos. A IA pôs intensidade fácil no aquecimento e nos drills.
const swim: WorkoutBlock[] = [
  { label: "Aquecimento", duration_min: 6, intensity: 50 },
  { label: "Técnica / drills", duration_min: 4, intensity: 50 },
  { label: "Série 1 forte", duration_min: 2.6, intensity: 88 },
  { label: "Descanso 1", duration_min: 0.5, intensity: 40 },
  { label: "Série 2 forte", duration_min: 2.6, intensity: 88 },
  { label: "Descanso 2", duration_min: 0.5, intensity: 40 },
  { label: "Série 3 forte", duration_min: 2.6, intensity: 88 },
  { label: "Descanso 3", duration_min: 0.5, intensity: 40 },
  { label: "Série 4 forte", duration_min: 2.6, intensity: 88 },
  { label: "Volta à calma", duration_min: 8, intensity: 50 },
];

const P = plannedZones(swim)!;
const min = (s: number) => Math.round((s / 60) * 10) / 10;
console.log(`\n  prescrito → z0 ${min(P.z0)}min · z1 ${min(P.z1)}min · z3 ${min(P.z3)}min`);

// 6 aquecimento + 4 drills + 3×0,5 descanso + 8 soltura = 19,5min
ck("aquecimento, drills, descansos e volta à calma viram tempo ABERTO",
  min(P.z0) === 19.5, `z0=${min(P.z0)}min`);
ck("nada de Z1: ninguém prescreveu Z1", P.z1 === 0, `z1=${min(P.z1)}min`);
ck("só as séries são pontuáveis", min(P.z3) === 10.4, `z3=${min(P.z3)}min`);

// O que ele de fato nadou.
const A: ZoneSeconds = { z0: 0, z1: 6 * 60, z2: 16 * 60, z3: 3 * 60, z4: 60, z5: 60 };
const nota = zoneAdherence(P, A)!;
console.log(`  nota agora: ${nota}  (antes desta correção: 31)`);
ck("a natação bem executada deixa de ser reprovada", nota >= 70, String(nota));

// ── A correção não pode perdoar quem realmente não fez ─────────────────────
const soFacil: ZoneSeconds = { z0: 0, z1: 27 * 60, z2: 0, z3: 0, z4: 0, z5: 0 };
const notaFacil = zoneAdherence(P, soFacil)!;
ck("pular as séries e só nadar fácil ainda cai", notaFacil < nota, `${notaFacil} vs ${nota}`);

// Um treino que é SÓ aquecimento e soltura não tem o que pontuar — e dizer
// isso (null) manda o painel de volta para a estimativa por duração.
ck("sessão inteira de tempo aberto não é prescrição a medir",
  plannedZones([
    { label: "Aquecimento", duration_min: 10, intensity: 50 },
    { label: "Volta à calma", duration_min: 10, intensity: 50 },
  ]) === null);

// E um treino sem nenhum bloco aberto segue exatamente como era.
const puro: WorkoutBlock[] = [{ label: "4x8min limiar", duration_min: 32, intensity: 95 }];
ck("treino sem bloco aberto não muda", plannedZones(puro)!.z4 === 32 * 60);

console.log(fail === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
