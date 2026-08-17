// A distribuição de carga do plantel. Rode com:
//   npx tsx product/tests/roster-load-view.ts
//
// O que está em jogo aqui é UM número: o denominador. getRosterLoad omite do
// array quem não tem sessão nenhuma, e classifyLoad devolve null para quem tem
// pouca história — se a barra contasse as LINHAS em vez do plantel, ela ficaria
// mais verde justamente quando faltasse dado.
import {
  viewRosterLoad, isLoadBand, LOAD_BANDS, LOAD_TONE, LOAD_LABEL,
} from "../../lib/roster-load-view";
import type { RosterLoadSummary } from "../../lib/roster-load";
import { demoCohort, demoLoad } from "../../lib/demo-roster";
import { parseDate } from "../../lib/utils";

let fail = 0;
const ck = (l: string, c: boolean, e = "") => {
  if (!c) { fail++; console.log("FAIL  " + l + (e ? "  → " + e : "")); }
  else console.log("ok    " + l);
};

const HOJE = "2026-08-17";

const row = (over: Partial<RosterLoadSummary> = {}): RosterLoadSummary => ({
  tenant_id: "t1",
  load_date: HOJE,
  ctl: 70, atl: 75, tsb: -5,
  prev_date: "2026-08-10", prev_tsb: -4,
  history_days: 180, sessions_42d: 24,
  ...over,
});

// ── O denominador é o plantel, nunca as linhas ──────────────────────────────

{
  // Três atletas no roster, um só com leitura.
  const v = viewRosterLoad(["a", "b", "c"], [row({ tenant_id: "a" })], HOJE);
  ck("quem some da query cai em 'none', não em 'ok'", v.counts.none === 2, JSON.stringify(v.counts));
  ck("o total é o do plantel, não o das linhas", v.total === 3);
  ck("as faixas somam o total", LOAD_BANDS.reduce((s, b) => s + v.counts[b], 0) === 3);
  ck("o atleta com leitura fica na faixa certa", v.bandFor("a") === "ok");
  ck("os outros dois são 'none'", v.bandFor("b") === "none" && v.bandFor("c") === "none");
  ck("stateFor devolve null para quem não tem leitura", v.stateFor("b") === null);
  ck("stateFor devolve o estado de quem tem", v.stateFor("a")?.level === "ok");
}

{
  // A linha existe mas classifyLoad se recusa a ler (história curta demais).
  const v = viewRosterLoad(["a"], [row({ tenant_id: "a", history_days: 12 })], HOJE);
  ck("linha presente mas recusada também é 'none'", v.counts.none === 1 && v.bandFor("a") === "none");
  ck("e não conta como 'ok'", v.counts.ok === 0);
}

{
  // Linha de alguém que não está neste roster (troca de treinador, cache velho).
  const v = viewRosterLoad(["a"], [row({ tenant_id: "a" }), row({ tenant_id: "zz" })], HOJE);
  ck("linha fora do plantel não infla o total", v.total === 1);
}

{
  const v = viewRosterLoad(["a", "a", "b"], [row({ tenant_id: "a" })], HOJE);
  ck("id repetido conta uma vez só", v.total === 2 && v.counts.ok === 1 && v.counts.none === 1);
}

{
  const v = viewRosterLoad([], [], HOJE);
  ck("plantel vazio: total 0, sem faixa nenhuma", v.total === 0 && v.attention === 0);
}

// ── attention: o número que a manchete pergunta ─────────────────────────────

{
  const v = viewRosterLoad(
    ["over", "watch", "ok", "sem"],
    [
      row({ tenant_id: "over", tsb: -34, prev_tsb: -18 }),
      row({ tenant_id: "watch", tsb: -16, prev_tsb: -4 }),
      row({ tenant_id: "ok", tsb: -5 }),
    ],
    HOJE,
  );
  ck("attention = sobrecarga + atenção", v.attention === 2, String(v.attention));
  ck("'ok' e 'sem leitura' ficam de fora da manchete", v.counts.ok === 1 && v.counts.none === 1);
  ck("cada faixa recebe o seu", v.bandFor("over") === "overreaching" && v.bandFor("watch") === "watch");
}

// ── O coorte de nove, pelo mesmo caminho que a página usa ───────────────────

{
  const hoje = parseDate(HOJE);
  const cohort = demoCohort(hoje);
  const ids = cohort.map((a) => a.roster.tenant_id);
  const v = viewRosterLoad(ids, demoLoad(hoje), HOJE);

  ck("demo: nove atletas no denominador", v.total === 9, String(v.total));
  ck("demo: 2 em sobrecarga (Renato, Valentina)", v.counts.overreaching === 2, String(v.counts.overreaching));
  ck("demo: 1 em atenção (Chiara)", v.counts.watch === 1, String(v.counts.watch));
  ck("demo: 4 em ok", v.counts.ok === 4, String(v.counts.ok));
  ck("demo: 2 sem leitura (Gonçalo, Sofía)", v.counts.none === 2, String(v.counts.none));
  ck("demo: a manchete diz 3 de 9", v.attention === 3 && v.total === 9);
  ck("demo: Gonçalo (parou) é 'none', não 'ok'", v.bandFor("d4") === "none");
  ck("demo: Sofía (conta nova) é 'none', não 'ok'", v.bandFor("d8") === "none");
  ck("demo: Renato é sobrecarga e está subindo", v.stateFor("d5")?.rising === true && v.bandFor("d5") === "overreaching");
  ck("demo: Bruno (taper) é 'ok' e não está subindo", v.bandFor("d9") === "ok" && v.stateFor("d9")?.rising === false);
  ck("demo: a soma das faixas fecha com o plantel",
    LOAD_BANDS.reduce((s, b) => s + v.counts[b], 0) === 9);
}

// ── Faixa vinda da URL ──────────────────────────────────────────────────────

ck("isLoadBand aceita as quatro faixas", LOAD_BANDS.every(isLoadBand));
ck("isLoadBand recusa lixo", !isLoadBand("vermelho") && !isLoadBand("") && !isLoadBand(null) && !isLoadBand(["ok"]));

// ── As cores: vermelho está reservado, ausência não tem croma ───────────────

ck("'sem leitura' NÃO é vermelho", LOAD_TONE.none !== LOAD_TONE.overreaching);
ck("'sem leitura' é cinza neutro", LOAD_TONE.none === "var(--text-faint)");
ck("'ok' não usa o verde do farol", LOAD_TONE.ok !== "var(--good)");
ck("toda faixa tem cor e rótulo", LOAD_BANDS.every((b) => !!LOAD_TONE[b] && !!LOAD_LABEL[b]));

console.log(fail === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${fail} FALHA(S)`);
process.exit(fail === 0 ? 0 : 1);
