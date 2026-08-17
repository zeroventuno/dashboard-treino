// Fadiga no painel consolidado. Rode com:  npx tsx product/tests/roster-load.ts
import {
  classifyLoad, needsLoadAttention, isFresh, summarizeCurve,
  MIN_HISTORY_DAYS, MIN_SESSIONS_42D, MAX_STALE_DAYS, MAX_COMPARE_DAYS, RISING_DROP,
  type RosterLoadSummary,
} from "../../lib/roster-load";
import {
  dailyTss, extendCurve, CTL_DAYS, ATL_DAYS,
  TSB_HIGH_FATIGUE, TSB_PRODUCTIVE, TSB_NEUTRAL_HIGH, TSB_VERY_FRESH,
} from "../../lib/pmc-curve";
import { TSB_ZONES, zoneFor } from "../../lib/pmc";
import { demoLoad } from "../../lib/demo-roster";
import { addDays, parseDate, toISO } from "../../lib/utils";
import type { TrainingLoad, Workout } from "../../lib/types";

let fail = 0;
const ck = (l: string, c: boolean, e = "") => {
  if (!c) { fail++; console.log("FAIL  " + l + (e ? "  → " + e : "")); }
  else console.log("ok    " + l);
};

const HOJE = "2026-08-17";

/** Um resumo de curva, como summarizeCurve devolve. Padrão: atleta com meio ano
 * de histórico e rotina de verdade — o caso normal. Cada teste muda só o que
 * está em jogo. */
const row = (over: Partial<RosterLoadSummary> = {}): RosterLoadSummary => ({
  tenant_id: "t1",
  load_date: HOJE,
  ctl: 70,
  atl: 75,
  tsb: -5,
  prev_date: "2026-08-10",
  prev_tsb: -4,
  history_days: 180,
  sessions_42d: 24,
  ...over,
});

// ── As faixas são UMA só, compartilhada com o gráfico do atleta ────────────
// Este é o bug que o módulo existe para não repetir: o gráfico dizia "muito
// fatigado" abaixo de -25 enquanto o painel do treinador marcava -30.
ck("as bandas do gráfico vêm de pmc-curve, não de literais",
  TSB_ZONES[0].max === TSB_HIGH_FATIGUE && TSB_ZONES[1].max === TSB_PRODUCTIVE);
ck("o limite de alta fadiga é -25", TSB_HIGH_FATIGUE === -25, String(TSB_HIGH_FATIGUE));
ck("gráfico e painel concordam na borda exata de -25",
  zoneFor(TSB_HIGH_FATIGUE).key === "productive"
  && classifyLoad(row({ tsb: TSB_HIGH_FATIGUE }), HOJE)!.level !== "overreaching");
ck("um décimo abaixo, os dois viram alta fadiga",
  zoneFor(-25.1).key === "very-fatigued"
  && classifyLoad(row({ tsb: -25.1 }), HOJE)!.level === "overreaching");
ck("as constantes de tempo são 42 e 7", CTL_DAYS === 42 && ATL_DAYS === 7);

// ── Fadiga subindo: o achado que justifica a coluna ────────────────────────
// Ainda dentro da faixa produtiva (-25 a -10), mas caindo 17 pontos na semana:
// mantido o ritmo, ele atravessa -25 antes do próximo domingo. É exatamente a
// semana de antecedência que o treinador não tinha.
const subindo = classifyLoad(row({ tsb: -22, prev_tsb: -5 }), HOJE)!;
ck("fadiga subindo é detectada", subindo.rising === true, String(subindo.tsbDelta));
ck("fadiga subindo dentro da faixa produtiva vira 'watch'",
  subindo.level === "watch", subindo.level);
ck("a queda é reportada com sinal negativo", subindo.tsbDelta === -17, String(subindo.tsbDelta));
ck("a janela comparada é declarada", subindo.windowDays === 7, String(subindo.windowDays));

const fundo = classifyLoad(row({ tsb: -38, prev_tsb: -20 }), HOJE)!;
ck("TSB bem abaixo da faixa é 'overreaching'", fundo.level === "overreaching", fundo.level);

// ── Carga alta e ESTÁVEL não é fadiga subindo ──────────────────────────────
// O atleta em bloco pesado que se mantém em -34 há semanas está sendo treinado,
// não afundando. O estado continua sendo 'overreaching' (o número é o número),
// mas o alarme de TENDÊNCIA tem que ficar quieto — senão o treinador aprende a
// ignorar a coluna.
const estavel = classifyLoad(row({ tsb: -34, prev_tsb: -33 }), HOJE)!;
ck("carga alta e estável NÃO é sinalizada como subindo", estavel.rising === false, String(estavel.tsbDelta));
ck("mas o estado alto continua sendo relatado", estavel.level === "overreaching", estavel.level);

// A fronteira é onde um limiar mente, então ela é testada dos dois lados.
ck("queda de exatamente 10 pontos já conta",
  classifyLoad(row({ tsb: -20, prev_tsb: -10 }), HOJE)!.rising === true);
ck("queda de 9,9 pontos ainda é ruído",
  classifyLoad(row({ tsb: -19.9, prev_tsb: -10 }), HOJE)!.rising === false);
ck("o limiar de tendência é o exportado", RISING_DROP === 10, String(RISING_DROP));

// Aliviar não é subir: quem sai de -30 para -12 está se recuperando.
const aliviando = classifyLoad(row({ tsb: -12, prev_tsb: -30 }), HOJE)!;
ck("TSB subindo (recuperando) não é fadiga subindo", aliviando.rising === false, String(aliviando.tsbDelta));
ck("recuperando dentro da faixa produtiva fica 'ok'", aliviando.level === "ok", aliviando.level);

// ── Dado insuficiente devolve NULL, nunca um palpite ───────────────────────
ck("atleta sem nenhuma curva devolve null",
  classifyLoad(row({ load_date: null, ctl: null, atl: null, tsb: null, prev_date: null, prev_tsb: null, history_days: 0, sessions_42d: 0 }), HOJE) === null);
ck("tsb nulo devolve null", classifyLoad(row({ tsb: null }), HOJE) === null);

// Histórico curto: a curva nasce em ZERO na primeira sessão, então três semanas
// depois o CTL ainda está subindo do zero e o TSB reporta esse artefato como
// fadiga. Quem começou mês passado pode marcar -30 tendo feito uma semana honesta.
ck("curva curta demais devolve null",
  classifyLoad(row({ tsb: -33, history_days: 20 }), HOJE) === null, `MIN_HISTORY_DAYS=${MIN_HISTORY_DAYS}`);
ck("exatamente 42 dias de curva já vale",
  classifyLoad(row({ history_days: MIN_HISTORY_DAYS }), HOJE) !== null);
ck("um dia abaixo do mínimo não vale",
  classifyLoad(row({ history_days: MIN_HISTORY_DAYS - 1 }), HOJE) === null);
ck("o mínimo é uma constante de TEMPO (42 dias), não de sessões",
  MIN_HISTORY_DAYS === CTL_DAYS, String(MIN_HISTORY_DAYS));

// A unidade que quase quebrou tudo: 42 SESSÕES em 42 dias rejeitaria todo mundo
// (quem treina 4x/semana faz ~24). O corte de sessões é separado, e baixo.
ck("atleta de 4x/semana (24 sessões em 42 dias) NÃO é rejeitado",
  classifyLoad(row({ sessions_42d: 24 }), HOJE) !== null);
ck("atleta de 2x/semana (12 sessões) também passa",
  classifyLoad(row({ sessions_42d: 12 }), HOJE) !== null);
ck("quem praticamente parou devolve null",
  classifyLoad(row({ tsb: 12, sessions_42d: 4 }), HOJE) === null, `MIN_SESSIONS_42D=${MIN_SESSIONS_42D}`);
ck("exatamente o mínimo de sessões já vale",
  classifyLoad(row({ sessions_42d: MIN_SESSIONS_42D }), HOJE) !== null);
ck("os dois cortes têm unidades diferentes e nomes que dizem qual",
  MIN_HISTORY_DAYS === 42 && MIN_SESSIONS_42D === 8);

// Guarda defensiva: na prática a curva sempre chega a hoje, então isto só
// dispara se alguém entregar uma série que termina no passado.
ck("leitura velha demais devolve null",
  classifyLoad(row({ load_date: "2026-08-03", tsb: -35 }), HOJE) === null, `MAX_STALE_DAYS=${MAX_STALE_DAYS}`);
ck("no limite da idade máxima ainda vale",
  classifyLoad(row({ load_date: "2026-08-10" }), HOJE) !== null);
ck("leitura datada no futuro é recusada, não tratada como fresquíssima",
  classifyLoad(row({ load_date: "2026-08-20" }), HOJE) === null);

// ── Tendência ausente ≠ leitura ausente ───────────────────────────────────
const semTendencia = classifyLoad(row({ tsb: -33, prev_date: null, prev_tsb: null }), HOJE)!;
ck("sem ponto de comparação ainda há nível", semTendencia.level === "overreaching");
ck("sem ponto de comparação a tendência é null, não zero", semTendencia.tsbDelta === null);
ck("sem tendência, 'rising' é falso e não inventado", semTendencia.rising === false);

const janelaLarga = classifyLoad(row({ tsb: -20, prev_date: "2026-07-08", prev_tsb: 5 }), HOJE)!;
ck("comparação larga demais é descartada",
  janelaLarga.tsbDelta === null && janelaLarga.windowDays === null, `MAX_COMPARE_DAYS=${MAX_COMPARE_DAYS}`);
ck("com a tendência descartada, não vira 'watch' por engano",
  janelaLarga.level === "ok", janelaLarga.level);
ck("janela de 14 dias ainda é comparável",
  classifyLoad(row({ tsb: -25, prev_date: "2026-08-03", prev_tsb: -5 }), HOJE)!.tsbDelta === -20);

// ── Atleta descansado / em polimento não é sinalizado ─────────────────────
const polimento = classifyLoad(row({ ctl: 80, atl: 62, tsb: 18, prev_tsb: 4 }), HOJE)!;
ck("atleta em polimento fica 'ok'", polimento.level === "ok", polimento.level);
ck("atleta em polimento é reconhecido como fresco", isFresh(polimento) === true, String(polimento.tsb));
ck("'fresco' usa a mesma linha do gráfico (race-ready, +10)",
  TSB_NEUTRAL_HIGH === 10 && zoneFor(polimento.tsb).key === "race-ready");
ck("quem está só neutro não é 'fresco'",
  isFresh(classifyLoad(row({ tsb: 6 }), HOJE)!) === false);
ck("muito fresco continua fresco", TSB_VERY_FRESH === 25 && isFresh(classifyLoad(row({ tsb: 30 }), HOJE)!));

// Fim do polimento: TSB despenca de +25 para +6 porque ele voltou a treinar.
// A queda é real (rising = true, é um fato sobre o número), mas quem está fresco
// não vira alerta — senão toda semana pós-prova acende a coluna inteira.
const voltandoAoTreino = classifyLoad(row({ tsb: 6, prev_tsb: 25 }), HOJE)!;
ck("quem sai do polimento não é sinalizado", voltandoAoTreino.level === "ok", voltandoAoTreino.level);
ck("mas a queda continua sendo reportada como fato", voltandoAoTreino.rising === true, String(voltandoAoTreino.tsbDelta));

ck("carga produtiva estável é 'ok'",
  classifyLoad(row({ tsb: -18, prev_tsb: -15 }), HOJE)!.level === "ok");
ck("-10 com fadiga subindo ainda é 'ok' (borda da faixa é aberta)",
  classifyLoad(row({ tsb: TSB_PRODUCTIVE, prev_tsb: 5 }), HOJE)!.level === "ok");
ck("-10,1 com a mesma queda é 'watch'",
  classifyLoad(row({ tsb: -10.1, prev_tsb: 4.9 }), HOJE)!.level === "watch");

// ── Pureza ────────────────────────────────────────────────────────────────
const r = row({ tsb: -22, prev_tsb: -5 });
ck("função é pura (duas chamadas, mesmo resultado)",
  JSON.stringify(classifyLoad(r, HOJE)) === JSON.stringify(classifyLoad(r, HOJE)));
ck("a data de hoje é argumento, não relógio",
  classifyLoad(row({ load_date: "2026-08-10" }), "2026-08-24") === null);

// ── A curva compartilhada: uma definição, dois leitores ───────────────────
const sess = (date: string, tss: number): Workout => ({
  id: "", title: "", description: null, garmin_instructions: null, zwo_content: null,
  notes: null, nutrition_notes: null,
  planned_duration_min: null, planned_distance_km: null, actual_distance_km: null,
  date, discipline: "bike", status: "done", planned_tss: null, actual_tss: tss,
  actual_duration_min: null,
});

ck("TSS do dia soma as sessões do mesmo dia",
  dailyTss([sess("2026-08-01", 40), sess("2026-08-01", 60)])["2026-08-01"] === 100);
ck("actual ganha de planned",
  dailyTss([{ date: "2026-08-01", actual_tss: 90, planned_tss: 50 }])["2026-08-01"] === 90);
ck("sem actual, cai para planned",
  dailyTss([{ date: "2026-08-01", actual_tss: null, planned_tss: 50 }])["2026-08-01"] === 50);
ck("sem nenhum dos dois, o dia não existe",
  dailyTss([{ date: "2026-08-01", actual_tss: null, planned_tss: null }])["2026-08-01"] === undefined);

// Uma rotina de verdade: 100 TSS por dia, todo dia, por 200 dias (incluindo
// hoje — um único dia de folga no fim derruba o CTL uns 2,4 pontos, que é
// exatamente o tipo de detalhe que uma recorrência acumulativa esconde). No
// estado estacionário CTL e ATL convergem para 100 e o TSB vai a zero.
const diario: Workout[] = [];
for (let i = 200; i >= 0; i--) diario.push(sess(toISO(addDays(parseDate(HOJE), -i)), 100));
const curva = extendCurve([], diario, HOJE);
const ultimo = curva[curva.length - 1];
ck("a curva tem um ponto por dia até hoje", ultimo.date === HOJE, ultimo.date);
ck("carga constante converge CTL para o valor da carga",
  Math.abs(ultimo.ctl! - 100) < 1.5, String(ultimo.ctl));
ck("no estado estacionário o TSB vai a zero", Math.abs(ultimo.tsb!) < 1.5, String(ultimo.tsb));
ck("ATL responde mais rápido que CTL", ATL_DAYS < CTL_DAYS);

// Parar de treinar leva o TSB para CIMA (destreino), nunca para baixo — a razão
// de o atleta sumido virar 'fresco' e não 'overreaching'.
const parou = extendCurve([], diario.filter((w) => w.date <= toISO(addDays(parseDate(HOJE), -21))), HOJE);
ck("quem parou há três semanas fica com TSB positivo",
  parou[parou.length - 1].tsb! > 0, String(parou[parou.length - 1].tsb));

// summarizeCurve sobre a curva real: é assim que os números chegam ao classificador.
const resumo = summarizeCurve("t1", curva, diario.map((w) => w.date), HOJE);
ck("o resumo lê o último ponto da curva", resumo.load_date === HOJE);
ck("o resumo compara com exatamente 7 dias antes",
  resumo.prev_date === toISO(addDays(parseDate(HOJE), -7)), String(resumo.prev_date));
ck("o resumo mede o histórico em DIAS de curva", resumo.history_days === 200, String(resumo.history_days));
ck("o resumo conta SESSÕES nos últimos 42 dias", resumo.sessions_42d === 42, String(resumo.sessions_42d));
ck("carga constante e madura classifica como 'ok'", classifyLoad(resumo, HOJE)!.level === "ok");
ck("curva vazia vira resumo vazio, não exceção",
  summarizeCurve("t1", [], [], HOJE).load_date === null);
ck("resumo de curva vazia é recusado pelo classificador",
  classifyLoad(summarizeCurve("t1", [], [], HOJE), HOJE) === null);

// O atleta novo, ponta a ponta: sessões de verdade, curva de verdade, e o
// classificador precisa CALAR mesmo com o TSB parecendo assustador.
const novato: Workout[] = [];
for (let i = 20; i >= 1; i--) if (i % 2 === 0) novato.push(sess(toISO(addDays(parseDate(HOJE), -i)), 120));
const resumoNovato = summarizeCurve("novo", extendCurve([], novato, HOJE), novato.map((w) => w.date), HOJE);
ck("atleta novo tem TSB negativo de artefato", resumoNovato.tsb! < 0, String(resumoNovato.tsb));
ck("e mesmo assim o classificador cala", classifyLoad(resumoNovato, HOJE) === null,
  `history=${resumoNovato.history_days} sessions=${resumoNovato.sessions_42d}`);

// A curva continua uma história guardada quando existe (o caminho do import).
const semente: TrainingLoad[] = [
  { date: toISO(addDays(parseDate(HOJE), -2)), tss: 50, ctl: 60, atl: 70, tsb: -10, source: "garmin" },
];
const continuada = extendCurve(semente, [], HOJE);
ck("uma história guardada é continuada, não descartada",
  continuada.length === 3 && continuada[0].ctl === 60, String(continuada.length));

// ── A lista do treinador ──────────────────────────────────────────────────
const roster: RosterLoadSummary[] = [
  row({ tenant_id: "ok",       tsb: -5,  prev_tsb: -4 }),
  row({ tenant_id: "watch",    tsb: -22, prev_tsb: -5 }),
  row({ tenant_id: "fundo",    tsb: -38, prev_tsb: -30 }),
  row({ tenant_id: "abismo",   tsb: -45, prev_tsb: -40 }),
  row({ tenant_id: "sem-dado", tsb: -60, history_days: 10, sessions_42d: 3 }),
  row({ tenant_id: "fresco",   tsb: 20,  prev_tsb: 10 }),
];
const lista = needsLoadAttention(roster, HOJE);
ck("a lista traz só quem precisa de olhada", lista.length === 3, lista.map((x) => x.tenant_id).join(","));
ck("mais fundo primeiro, e 'watch' por último",
  lista.map((x) => x.tenant_id).join(",") === "abismo,fundo,watch",
  lista.map((x) => x.tenant_id).join(","));
ck("atleta sem dado suficiente NÃO entra na lista, nem no fim dela",
  !lista.some((x) => x.tenant_id === "sem-dado"));
ck("atleta fresco não entra na lista", !lista.some((x) => x.tenant_id === "fresco"));
ck("roster vazio devolve lista vazia", needsLoadAttention([], HOJE).length === 0);

// ── O coorte de demonstração (lib/demo-roster) continua exercitando tudo ──
// Ele é o banco de provas do painel; se um perfil deixar de cair no estado que
// o comentário dele promete, o banco parou de testar.
const demo = demoLoad(parseDate(HOJE));
const nivel = (id: string) => {
  const found = demo.find((d) => d.tenant_id === id);
  return found ? classifyLoad(found, HOJE) : undefined;
};
ck("demo: Marina (base produtiva estável) é 'ok'", nivel("d1")!.level === "ok");
ck("demo: Chiara (carga + queda de 12) é 'watch'", nivel("d3")!.level === "watch");
ck("demo: Gonçalo (praticamente parou) é silenciado", nivel("d4") === null);
ck("demo: Renato (sobrecarga clara) é 'overreaching'", nivel("d5")!.level === "overreaching");
ck("demo: Valentina (sobrecarga perto da prova) é 'overreaching'", nivel("d6")!.level === "overreaching");
ck("demo: Diogo (fresco por abandono) é 'ok' e fresco",
  nivel("d7")!.level === "ok" && isFresh(nivel("d7")!));
ck("demo: Sofía (conta nova) é silenciada", nivel("d8") === null);
ck("demo: Bruno (fresco de propósito, em taper) é 'ok' e fresco",
  nivel("d9")!.level === "ok" && isFresh(nivel("d9")!));
ck("demo: os dois 'frescos' são frescos por razões opostas",
  nivel("d7")!.tsbDelta! > 0 && nivel("d9")!.tsbDelta! > 0
  && demo.find((d) => d.tenant_id === "d7")!.ctl! < demo.find((d) => d.tenant_id === "d9")!.ctl!);

console.log(fail === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
