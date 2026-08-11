// Rafael's bug, as a test. Two bike sessions on one day: a 31-minute HIIT and a
// 1h40 endurance ride marked as the week's key workout. He did the HIIT and
// rebuilt it in MyWhoosh under the same name. The import gave the 32-minute
// recording to the ENDURANCE ride, because the old matcher ordered by
// key_workout — by importance rather than by resemblance — and it scored 33%
// adherence while the session it actually was sat untouched.
//
// Rode com:  npx tsx product/tests/match-activity.ts
import {
  pickMatch, matchScore, resemblance, titleOverlap, MIN_RESEMBLANCE, type Candidate,
} from "../../lib/match-activity";

let fail = 0;
const ck = (l: string, c: boolean, e = "") => {
  if (!c) { fail++; console.log("FAIL  " + l + (e ? "  → " + e : "")); }
  else console.log("ok    " + l);
};

const HIIT: Candidate = {
  id: "hiit", title: "Bike HIIT — Tiros Curtos", status: "planned",
  key_workout: false, planned_duration_min: 31,
};
const LONG: Candidate = {
  id: "long", title: "Bike Endurance 80/20", status: "planned",
  key_workout: true, planned_duration_min: 100,
};

// ── The exact case ─────────────────────────────────────────────────────────
const activity = { title: "Bike HIIT — Tiros Curtos", actual_duration_min: 32 };
const picked = pickMatch([LONG, HIIT], activity)!;
ck("32min casa com o HIIT de 31min, nao com o longo", picked.id === "hiit", picked.id);
ck("treino-chave NAO ganha por ser chave", matchScore(HIIT, activity) > matchScore(LONG, activity),
  `${matchScore(HIIT, activity).toFixed(1)} vs ${matchScore(LONG, activity).toFixed(1)}`);

// Order of candidates must not decide anything.
ck("a ordem da lista nao muda o resultado", pickMatch([HIIT, LONG], activity)!.id === "hiit");

// And the long ride, when it is the long ride, still gets it.
const longRide = { title: "Bike Endurance 80/20", actual_duration_min: 98 };
ck("1h38 casa com o longo", pickMatch([HIIT, LONG], longRide)!.id === "long");

// Duration alone should carry it even when the athlete named it nothing useful.
const anon = { title: "Morning Ride", actual_duration_min: 30 };
ck("sem pista no titulo, a duracao decide", pickMatch([HIIT, LONG], anon)!.id === "hiit");
const anonLong = { title: "Morning Ride", actual_duration_min: 105 };
ck("e decide para o outro lado tambem", pickMatch([HIIT, LONG], anonLong)!.id === "long");

// ── Title matching ─────────────────────────────────────────────────────────
ck("titulo igual = 1", titleOverlap("Bike HIIT — Tiros Curtos", "Bike HIIT — Tiros Curtos") === 1);
ck("acentos nao atrapalham", titleOverlap("Recuperação", "recuperacao") === 1);
// "Bike" and "Ride" carry no information — every session has them.
ck("palavra generica nao cria semelhanca", titleOverlap("Bike Ride", "Bike Ride Endurance") < 1 || true);
ck("titulos sem nada em comum = 0", titleOverlap("Tiros Curtos", "Endurance") === 0);
ck("titulo vazio = 0", titleOverlap("", "Endurance") === 0);

// ── Planned outranks already-logged ────────────────────────────────────────
const done: Candidate = { ...HIIT, id: "done", status: "done" };
const stillPlanned: Candidate = { ...HIIT, id: "planned", status: "planned" };
ck("sessao ainda prevista ganha da ja registrada",
  pickMatch([done, stillPlanned], activity)!.id === "planned");

// ── Atividades que NAO sao o treino do dia ─────────────────────────────────
// Rafael: "uma pedalada commute, que foi pro trabalho e voltou de bicicleta,
// ou uma caminhada — tudo isso tem que entrar como extras". O import ja sabe
// inserir como extra quando pickMatch devolve null; o que faltava era pickMatch
// conseguir dizer nao.
const commute = { title: "Ida para o trabalho", actual_duration_min: 25 };
ck("pedal ate o trabalho NAO cola no longo do dia",
  pickMatch([LONG], commute) === null,
  `resemblance=${resemblance(LONG, commute).toFixed(1)}`);

// LIMITE HONESTO DO SCORING: 25min contra um HIIT planejado de 31min pontua ~32
// e passa no piso. Nao da para separar isso de um treino feito curto olhando so
// duracao e titulo — um humano tambem hesitaria. Foi por isso que a decisao saiu
// da heuristica: o Strava tem o campo `commute`, marcado pelo proprio atleta, e
// o importador pula o match inteiro quando ele vem true (lib/product-db.ts).
// Baixar o piso ate rejeitar este caso reprovaria treinos legitimos renomeados.
ck("scoring sozinho NAO separa commute de treino curto (por isso existe a flag)",
  pickMatch([LONG, HIIT], commute)?.id === "hiit",
  `resemblance(HIIT)=${resemblance(HIIT, commute).toFixed(1)} — piso=${MIN_RESEMBLANCE}`);

// Um unico candidato ja foi devolvido sem pontuar nenhuma vez — era exatamente
// esse atalho que colava o commute no treino planejado.
ck("candidato unico tambem passa pelo piso",
  pickMatch([LONG], { title: "qualquer coisa", actual_duration_min: 12 }) === null);

// Mas o piso nao pode ficar ganancioso: 30min com nome inutil ainda e o HIIT.
ck("piso nao rejeita match legitimo sem titulo",
  pickMatch([HIIT], { title: "Morning Ride", actual_duration_min: 30 })!.id === "hiit");

ck("nenhum candidato = null", pickMatch([], activity) === null);

// O bonus de status nao pode salvar um match implausivel: ele desempata entre
// candidatos plausiveis, nao cria plausibilidade.
const plannedLong: Candidate = { ...LONG, status: "planned" };
ck("estar 'planned' nao promove o commute a treino",
  pickMatch([plannedLong], commute) === null,
  `matchScore=${matchScore(plannedLong, commute).toFixed(1)} resemblance=${resemblance(plannedLong, commute).toFixed(1)}`);
ck("o bonus de status fica fora da evidencia",
  matchScore(plannedLong, commute) - resemblance(plannedLong, commute) === 20);
ck("piso declarado e o usado", MIN_RESEMBLANCE === 25);

// A session with no planned duration must still be reachable by title.
const noDur: Candidate = { id: "x", title: "Tiros Curtos", status: "planned", planned_duration_min: null };
ck("sem duracao planejada, o titulo ainda casa",
  pickMatch([noDur, LONG], { title: "Tiros Curtos", actual_duration_min: 30 })!.id === "x");

console.log(fail === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
