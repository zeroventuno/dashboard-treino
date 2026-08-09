// ────────────────────────────────────────────────────────────────────────────
//  The landing page — mytrakr.fit
//
//  Built to the v2 direction: near-black, acid lime, condensed uppercase set
//  very large, 2px corners, a hairline grid running behind everything. That is
//  a deliberately DIFFERENT language from the dashboard, which is a working
//  instrument — lighter graphite, 20px radii, soft cards, tuned for reading
//  numbers for an hour. The landing is a poster. They share a brand and little
//  else, so its tokens live under `.ld-root` instead of bending the app's.
//
//  Copy is Portuguese and lives in this file rather than lib/i18n.ts: that
//  dictionary is typed, so a reworded headline would break the build in five
//  languages. Marketing text churns weekly. Translating later is mechanical.
//
//  Motion is CSS plus one IntersectionObserver — no animation library. This is
//  the first thing a prospect loads, usually on a phone on mobile data.
// ────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import Link from "next/link";
import { Backdrop } from "@/components/landing/Backdrop";
import { Nav, Rail } from "@/components/landing/chrome";
import { Reveal, Counter, Cycler } from "@/components/landing/motion";
import { PriceCalc } from "@/components/landing/PriceCalc";
import { RACE_DATE, RACE_NAME } from "@/lib/types";
import { daysBetween, toISO } from "@/lib/utils";

export const metadata: Metadata = {
  title: "MY TRAKR — o painel de treino que se preenche sozinho",
  description:
    "O relógio manda o treino, a sua IA lê o painel e escreve a semana. Para atletas e para assessorias que querem atender 100 alunos com o cuidado que hoje dão a 30.",
};

// The live panel below shows a real countdown. Hourly is plenty for a number
// that moves once a day, and it keeps the page static between rebuilds.
export const revalidate = 3600;

// ── shared bits ─────────────────────────────────────────────────────────────

function SectionLabel({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <p className="ld-label flex items-center gap-3 text-[var(--ld-faint)]">
      <span className="tk-pulse block h-[6px] w-[6px] bg-[var(--ld-lime)]" />
      {n} — {children}
    </p>
  );
}

function Headline({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <h2
      className={`ld-dsp max-w-[18ch] text-balance text-[34px] font-bold leading-[.96] tracking-[-.01em] text-[var(--ld-ink)] sm:text-[clamp(38px,5vw,68px)] ${className}`}
    >
      {children}
    </h2>
  );
}

function Stat({ value, label, ...rest }: { value: React.ReactNode; label: string }) {
  return (
    <div {...rest}>
      <p className="ld-dsp text-[46px] font-bold leading-none text-[var(--ld-ink)] sm:text-[58px]">{value}</p>
      <p className="ld-label mt-3 text-[var(--ld-faint)]">{label}</p>
    </div>
  );
}

const SECTION_PAD = "relative z-[2] mx-auto w-full max-w-[1400px] px-[22px] py-[104px] sm:px-10 sm:py-[140px]";

// ── 02 · the four layers ────────────────────────────────────────────────────

const LAYERS = [
  {
    n: "01",
    title: "Captura",
    body: "Garmin, Coros, Polar e Suunto entram pelo Strava. Ou suba o .fit e o painel lê até tempo de contato com o solo, oscilação vertical e potência de corrida — números que nenhuma API entrega.",
  },
  {
    n: "02",
    title: "Leitura",
    body: "Fitness, fadiga e forma ao longo do tempo. E quanto tempo você passou em cada zona, lado a lado com o que o treino pedia — porque duas sessões de uma hora podem ser treinos completamente diferentes, e a duração sozinha não conta essa história.",
  },
  {
    n: "03",
    title: "Decisão",
    body: "A sua IA lê o histórico inteiro antes de responder. A semana sai da conversa: treinos, ajustes e o check-in do dia, já organizados no painel.",
  },
  {
    n: "04",
    title: "Volta",
    body: "O treino vira arquivo — .zwo para o rolo, .fit para o relógio. Você treina, o relógio grava, e a captura recomeça. Ninguém digita nada em lugar nenhum.",
  },
];

// ── 03 · connections ────────────────────────────────────────────────────────

const SOURCES = ["Strava", "Garmin", "Coros", "Polar", "Suunto", "Zwift", "Rolo", "Potência", "HRV", "Sono", ".fit"];
const METRICS = ["Fitness", "Fadiga", "Forma", "HRV", "TSS", "CTL", "ATL", "VO₂max", "FTP", "CSS", "Zonas", "Prontidão"];

function Marquee({ items, reverse = false }: { items: string[]; reverse?: boolean }) {
  return (
    <div
      className="relative overflow-hidden py-1"
      style={{
        maskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)",
        WebkitMaskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)",
      }}
    >
      {/* Two identical copies: -50% lands exactly on the seam, so the loop has
          no visible jump. */}
      <div className={`flex w-max ${reverse ? "tk-marquee-fast" : "tk-marquee"}`}>
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0" aria-hidden={copy === 1}>
            {items.map((item) => (
              <span
                key={item}
                className="ld-dsp flex items-center gap-6 whitespace-nowrap px-6 text-[15px] font-semibold tracking-[.14em] text-[rgba(232,234,230,.3)] sm:text-[17px]"
              >
                {item}
                <span className="block h-[3px] w-[3px] bg-[var(--ld-lime)]" />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 05 · the live panel mock ────────────────────────────────────────────────
// Drawn, never screenshotted: a screenshot dates the moment the UI moves and
// leaks whichever athlete's data was on screen when it was taken.

const ZONE_ROWS = [
  { z: "Z2", planned: "6h20", done: "6h05", p: 100, a: 96, col: "var(--good)" },
  { z: "Z4", planned: "52min", done: "30min", p: 62, a: 36, col: "var(--warn)" },
  { z: "Z5", planned: "12min", done: "12min", p: 22, a: 22, col: "var(--bad)" },
];

// Phase colours come from the app's own variables, so the mock can never drift
// from the palette the real season block uses.
const SEASON = [
  { h: 30, c: "var(--phase-base)", phase: "Base" },
  { h: 38, c: "var(--phase-base)", phase: "Base" },
  { h: 34, c: "var(--phase-base)", phase: "Base" },
  { h: 46, c: "var(--phase-base)", phase: "Base" },
  { h: 56, c: "var(--phase-build)", phase: "Build" },
  { h: 68, c: "var(--phase-build)", phase: "Build" },
  { h: 62, c: "var(--phase-build)", phase: "Build" },
  { h: 82, c: "var(--phase-build)", phase: "Build" },
  { h: 100, c: "var(--phase-peak)", phase: "Peak" },
  { h: 88, c: "var(--phase-peak)", phase: "Peak" },
  { h: 60, c: "var(--phase-taper)", phase: "Taper" },
  { h: 44, c: "var(--phase-taper)", phase: "Taper" },
  { h: 26, c: "var(--phase-race)", phase: "Race" },
];

/** A card in the APP's language, not the landing's.
 *
 * This whole section exists to show what is actually on screen today, so it
 * borrows the dashboard's tokens: --surface on --bg, 20px radii, and the italic
 * Saira title over a muted subtitle that every real block uses. Rendering it in
 * the poster's sharp 2px style would be showing a product we don't ship. */
function AppCard({
  title,
  sub,
  children,
  className = "",
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow)] ${className}`}
      style={{ borderRadius: "var(--radius)" }}
    >
      <p className="dsp text-[17px] font-extrabold italic text-[var(--text)]">{title}</p>
      {sub && <p className="mt-0.5 text-[11.5px] text-[var(--text-faint)]">{sub}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function LivePanel({ days, weeks, restDays }: { days: number; weeks: number; restDays: number }) {
  return (
    // The app canvas is LIGHTER than the landing — that contrast is what makes
    // the panel read as a real screen sitting inside the page rather than as
    // more marketing drawn in the marketing style.
    <div
      className="bg-[var(--bg)] p-4 sm:p-6"
      style={{ borderRadius: 24, border: "1px solid var(--border-soft)" }}
    >
      <div className="flex flex-col gap-4">
        {/* hero: countdown + readiness, exactly the app's top block */}
        <div
          className="grid gap-4 border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow)] lg:grid-cols-[1.3fr_1fr]"
          style={{ borderRadius: "var(--radius)" }}
        >
          <div>
            <p className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.16em] text-[var(--bad)]">
              <span className="block h-1.5 w-1.5 rounded-full bg-[var(--bad)]" />
              {RACE_NAME}
            </p>
            <div className="mt-3 flex items-end gap-3">
              <span className="dsp text-[72px] font-extrabold italic leading-[.8] text-[var(--text)] sm:text-[86px]">
                <Counter to={days} />
              </span>
              <span className="pb-2 text-[13px] leading-tight text-[var(--text-muted)]">
                dias para
                <br />o dia da prova
              </span>
            </div>
            <p className="mt-4 text-[11.5px] text-[var(--text-faint)]">
              25 de out. de 2026 · {weeks} sem {restDays} d
            </p>
          </div>

          <div
            className="bg-[var(--bg-soft)] p-4"
            style={{ borderRadius: "var(--radius-sm)", border: "1px solid var(--border-soft)" }}
          >
            <p className="text-[9.5px] font-bold uppercase tracking-[0.2em] text-[var(--text-faint)]">
              Prontidão hoje
            </p>
            <p className="dsp mt-1 text-[30px] font-extrabold italic uppercase leading-none text-[var(--warn)]">
              Manter
            </p>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {[
                { k: "Score", v: 78 },
                { k: "HRV", v: 62 },
                { k: "Bateria", v: 71 },
              ].map((m) => (
                <div key={m.k}>
                  <p className="dsp text-[19px] font-extrabold italic leading-none text-[var(--text)]">
                    <Counter to={m.v} />
                  </p>
                  <p className="mt-1 text-[8.5px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                    {m.k}
                  </p>
                </div>
              ))}
              <div>
                <p className="dsp text-[19px] font-extrabold italic leading-none text-[var(--text)]">7h41</p>
                <p className="mt-1 text-[8.5px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
                  Sono
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <AppCard title="Condicionamento & Frescor" sub="Fitness, fadiga e forma ao longo do tempo">
            <div className="flex items-end gap-7">
              {[
                { k: "Fitness", v: 58, c: "var(--bad)" },
                { k: "Fadiga", v: 40, c: "var(--warn)" },
                { k: "Forma", v: 18, c: "var(--teal)", sign: "+" },
              ].map((m) => (
                <div key={m.k}>
                  <p className="dsp text-[32px] font-extrabold italic leading-none" style={{ color: m.c }}>
                    {m.sign}
                    <Counter to={m.v} />
                  </p>
                  <p className="mt-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--text-faint)]">
                    {m.k}
                  </p>
                </div>
              ))}
              <p className="ml-auto text-right text-[11.5px] leading-snug text-[var(--text-faint)]">
                VO₂max <span className="text-[var(--text)]">52,4</span>
                <br />
                <span className="text-[var(--good)]">▲ 1,4</span> em 3 meses
              </p>
            </div>
          </AppCard>

          <AppCard title="Tempo em Zona" sub="Prescrito × feito — por zona, não só a duração">
            <div className="flex flex-col gap-3">
              {ZONE_ROWS.map((r) => (
                <div key={r.z} className="grid grid-cols-[26px_1fr_auto] items-center gap-3">
                  <span className="dsp text-[12px] font-extrabold italic" style={{ color: r.col }}>
                    {r.z}
                  </span>
                  <span className="flex flex-col gap-[3px]">
                    <span
                      className="ld-fill block h-[5px] rounded-full border"
                      style={{ ["--to" as string]: `${r.p}%`, borderColor: r.col }}
                    />
                    <span
                      className="ld-fill block h-[5px] rounded-full"
                      style={{ ["--to" as string]: `${r.a}%`, background: r.col }}
                    />
                  </span>
                  <span className="tnum text-[11px] text-[var(--text-faint)]">
                    {r.planned} / <span className="text-[var(--text)]">{r.done}</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[12px] text-[var(--text-muted)]">
              <span className="font-bold" style={{ color: "var(--warn)" }}>
                −22min em Z4
              </span>{" "}
              a menos do que foi pedido
            </p>
          </AppCard>
        </div>

        <AppCard title="Temporada" sub="Volume semanal por fase, da base ao dia da prova">
          <div className="flex h-[96px] items-end gap-[6px]">
            {SEASON.map((s, i) => (
              <span
                key={i}
                className="ld-rise block flex-1 rounded-[3px]"
                style={{ height: `${s.h}%`, background: s.c, transitionDelay: `${i * 55}ms` }}
                title={s.phase}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
            {[
              { p: "Base", c: "var(--phase-base)" },
              { p: "Build", c: "var(--phase-build)" },
              { p: "Peak", c: "var(--phase-peak)" },
              { p: "Taper", c: "var(--phase-taper)" },
              { p: "Race", c: "var(--phase-race)" },
            ].map((l) => (
              <span
                key={l.p}
                className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-[var(--text-faint)]"
              >
                <span className="block h-[7px] w-[7px] rounded-sm" style={{ background: l.c }} />
                {l.p}
              </span>
            ))}
          </div>
        </AppCard>
      </div>
    </div>
  );
}

// ── 07 · athlete plans ──────────────────────────────────────────────────────

const PLANS = [
  {
    tag: "Quem entra agora",
    badge: "Fundador",
    price: "€7",
    per: "/mês",
    body: "Preço travado enquanto você for assinante. Tudo o que o plano normal tem, e o que vier depois.",
    cta: "Quero o preço de fundador",
    featured: true,
  },
  {
    tag: "Mensal",
    badge: null,
    price: "€15",
    per: "/mês",
    body: "O painel completo, sem compromisso de prazo. Cancele quando quiser.",
    cta: "Começar",
    featured: false,
  },
  {
    tag: "Anual",
    badge: "2 meses grátis",
    price: "€150",
    per: "/ano",
    body: "Paga dez meses, usa doze. Dá €12,50 por mês.",
    cta: "Assinar o ano",
    featured: false,
  },
];

const TIER_ROWS = [
  { r: "1 – 10 alunos", p: "€10" },
  { r: "11 – 50 alunos", p: "€9" },
  { r: "51 – 100 alunos", p: "€8" },
  { r: "Acima de 100", p: "Fale com a gente" },
];

const PROGRESS = [
  { w: "Semana 01", ctl: 34, note: "6h · 3 furos na semana" },
  { w: "Semana 04", ctl: 44, note: "8h · check-in fechado" },
  { w: "Semana 08", ctl: 52, note: "11h · limiar estável" },
  { w: "Semana 12", ctl: 58, note: "13h · FTP 158 → 170 W" },
];

// ── page ────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const days = Math.max(0, daysBetween(toISO(new Date()), RACE_DATE));
  const weeks = Math.floor(days / 7);
  const restDays = days % 7;

  return (
    <div className="ld-root relative w-full overflow-x-clip">
      <Backdrop />
      <Nav />
      <Rail />

      {/* ══ 00 · hero ══ */}
      <section id="topo" className="relative z-[2] flex min-h-screen flex-col justify-center px-[22px] pb-[120px] pt-[140px] sm:px-10">
        <div className="mx-auto w-full max-w-[1400px]">
          <Reveal>
            <p className="ld-label flex items-center gap-3.5 text-[12px] tracking-[.28em] text-[var(--ld-faint)]">
              <span className="tk-pulse block h-[6px] w-[6px] bg-[var(--ld-lime)]" />
              Painel de treino multiesporte
            </p>
          </Reveal>

          <div className="mt-12 grid gap-1 sm:mt-14">
            <Reveal as="wipe" delay={60}>
              <span className="ld-dsp block font-bold leading-[.92] tracking-[-.01em] text-[var(--ld-ink)] text-[clamp(48px,9vw,148px)]">
                MY TRAKR
              </span>
            </Reveal>
            <Reveal as="wipe" delay={140}>
              <span className="ld-dsp block font-bold leading-[.92] tracking-[-.01em] text-[var(--ld-lime)] text-[clamp(48px,9vw,148px)]">
                <Cycler words={["Natação", "Bike", "Corrida", "Força"]} />
              </span>
            </Reveal>
            {["Bike", "Corrida", "Força"].map((w, i) => (
              <Reveal key={w} as="wipe" delay={200 + i * 60}>
                <span className="ld-dsp block font-bold leading-[.92] tracking-[-.01em] text-[var(--ld-ghost)] text-[clamp(48px,9vw,148px)]">
                  {w}
                </span>
              </Reveal>
            ))}
          </div>

          <div className="mt-16 flex flex-wrap items-end justify-between gap-10">
            <Reveal delay={420}>
              <p className="max-w-[460px] text-pretty text-[16px] leading-[1.7] text-[var(--ld-dim)]">
                O relógio manda o treino. A sua IA lê o painel e escreve a semana. Você só treina — os
                números chegam sozinhos.
              </p>
            </Reveal>
            <Reveal delay={480}>
              <p className="ld-label flex items-center gap-4 text-[12px] tracking-[.24em] text-[var(--ld-faint)]">
                <span
                  className="tk-line block h-[54px] w-px"
                  style={{ background: "linear-gradient(180deg, var(--ld-lime), rgba(166,229,26,0))" }}
                />
                Role para descobrir
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ══ 01 · the panel ══ */}
      <section id="quem" className={SECTION_PAD}>
        <Reveal>
          <SectionLabel n="01">O painel</SectionLabel>
        </Reveal>
        <div className="mt-9 grid gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <Reveal delay={60}>
            <Headline>O MY TRAKR junta tudo o que você já registra.</Headline>
          </Reveal>
          <Reveal delay={140}>
            <div className="flex flex-col gap-5 text-[15px] leading-[1.75] text-[var(--ld-dim)] lg:pt-3">
              <p>
                Treino, carga, recuperação, zonas, composição corporal, lesões e nutrição em um lugar
                só — no mesmo dia, na mesma escala, na mesma leitura. O que era print, planilha e
                memória vira histórico.
              </p>
              <p>
                E a inteligência não é mais uma assinatura: você conecta o Claude ou o ChatGPT que já
                usa, e ele passa a ler o seu histórico inteiro antes de escrever o próximo treino.
              </p>
              <a
                href="#oque"
                className="ld-label mt-1 flex w-fit items-center gap-3 text-[var(--ld-lime)] transition-opacity hover:opacity-70"
              >
                O que ele faz
                <span aria-hidden>→</span>
              </a>
            </div>
          </Reveal>
        </div>

        <Reveal delay={200}>
          <div className="mt-20 h-px w-full origin-left bg-[var(--ld-line)] ld-rule" />
          <div className="mt-10 grid gap-10 sm:grid-cols-3">
            <Stat value={<Counter to={6} />} label="Fontes conectadas" />
            <Stat value={<Counter to={4} />} label="Esportes no mesmo plano" />
            <Stat value="24/7" label="Sincronizado sozinho" />
          </div>
        </Reveal>
      </section>

      {/* ══ 02 · what it does ══ */}
      <section id="oque" className={SECTION_PAD}>
        <Reveal>
          <SectionLabel n="02">O que faz</SectionLabel>
        </Reveal>
        <div className="mt-9 grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <Reveal delay={60}>
            <Headline>Quatro camadas que se completam.</Headline>
          </Reveal>
          <Reveal delay={140}>
            <p className="text-[15px] leading-[1.75] text-[var(--ld-dim)] lg:pt-3">
              Nenhuma delas funciona sozinha. O dado alimenta a leitura, a leitura vira decisão, a
              decisão volta como treino — e o ciclo recomeça na segunda-feira.
            </p>
          </Reveal>
        </div>

        <div className="mt-16 border-t border-[var(--ld-line)]">
          {LAYERS.map((l, i) => (
            <Reveal key={l.n} delay={i * 70}>
              <div className="ld-row grid grid-cols-[auto_1fr] items-start gap-6 border-b border-[var(--ld-line)] py-8 sm:grid-cols-[auto_minmax(0,300px)_1fr_auto] sm:items-center sm:gap-10">
                <span className="ld-dsp ld-rownum text-[13px] font-semibold tracking-[.2em] text-[rgba(232,234,230,.3)]">
                  {l.n}
                </span>
                <h3 className="ld-dsp text-[24px] font-bold leading-none text-[var(--ld-ink)] sm:text-[30px]">
                  {l.title}
                </h3>
                <p className="col-span-2 text-[14px] leading-[1.7] text-[var(--ld-dim)] sm:col-span-1">
                  {l.body}
                </p>
                <span className="ld-arrow hidden text-[18px] text-[rgba(232,234,230,.3)] sm:block" aria-hidden>
                  →
                </span>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ══ 03 · connections ══ */}
      <section id="conexoes" className={SECTION_PAD}>
        <Reveal>
          <SectionLabel n="03">Conexões</SectionLabel>
        </Reveal>
        <Reveal delay={60}>
          <Headline className="mt-9 max-w-[24ch]">
            Seus dados estão em todo lugar. Sua performance não deveria estar.
          </Headline>
        </Reveal>

        <Reveal delay={140}>
          <div className="mt-14">
            <Marquee items={SOURCES} />
          </div>
        </Reveal>

        <div className="mt-14 grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
          <Reveal delay={80}>
            <p className="text-[15px] leading-[1.75] text-[var(--ld-dim)]">
              Você já registra tudo. Mas quando a semana rende menos, a resposta está espalhada: o
              sono num app, a carga em outro, o treino num terceiro e a balança num caderno. O dado
              existe — ele só nunca esteve no mesmo lugar, no mesmo dia, na mesma escala.
            </p>
          </Reveal>

          <Reveal delay={160}>
            <div className="flex flex-col">
              {[
                { k: "Sincronização automática", v: "Strava" },
                { k: "Upload manual", v: ".fit / .gpx" },
                { k: "Treino para o rolo", v: ".zwo" },
                { k: "Camada de inteligência", v: "Claude · ChatGPT" },
              ].map((row, i) => (
                <div
                  key={row.k}
                  className={`flex items-baseline justify-between gap-6 py-4 ${
                    i === 0 ? "border-y" : "border-b"
                  } border-[var(--ld-line)]`}
                >
                  <span className="text-[14px] text-[var(--ld-dim)]">{row.k}</span>
                  <span className="ld-dsp text-[15px] font-semibold tracking-[.1em] text-[var(--ld-lime)]">
                    {row.v}
                  </span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>

        <Reveal delay={200}>
          <div className="mt-14">
            <Marquee items={METRICS} reverse />
          </div>
        </Reveal>
      </section>

      {/* ══ 04 · intelligence ══ */}
      <section id="inteligencia" className={SECTION_PAD}>
        <Reveal>
          <SectionLabel n="04">Inteligência</SectionLabel>
        </Reveal>
        <Reveal delay={60}>
          <Headline className="mt-9">O painel é a cara da sua conversa.</Headline>
        </Reveal>

        <div className="mt-14 grid gap-4 lg:grid-cols-[1fr_1fr] lg:gap-10">
          {/* The claim that has to be unmistakable — for honesty and for the
              athlete's own safety. MY TRAKR stores and shows; it never decides. */}
          <Reveal delay={100}>
            <div className="flex h-full flex-col justify-center gap-5 text-[15px] leading-[1.75] text-[var(--ld-dim)]">
              <p>
                <span className="text-[var(--ld-ink)]">O MY TRAKR não prescreve treino.</span> Ele é a
                camada visual da sua conversa com a sua IA: o que vocês dois combinaram vira
                calendário, gráfico, zona e arquivo — em vez de ficar perdido numa rolagem de chat.
              </p>
              <p>
                Quem escreve o plano é a sua IA, ou o seu treinador. O painel guarda, organiza,
                compara e devolve o histórico inteiro para a próxima pergunta. Nenhuma decisão de
                treino nasce aqui.
              </p>
              <p className="ld-label pt-2 text-[var(--ld-lime)]">
                Sua chave · seu chat · seu painel
              </p>
            </div>
          </Reveal>

          <Reveal delay={170}>
            <div className="flex h-full flex-col border border-[var(--ld-line)] bg-[rgba(232,234,230,.02)]" style={{ borderRadius: 2 }}>
              <div className="flex items-center justify-between border-b border-[var(--ld-line)] px-6 py-4">
                <span className="ld-label text-[var(--ld-lime)]">No seu chat</span>
                <span className="ld-label text-[10px] text-[rgba(232,234,230,.3)]">Claude · ChatGPT</span>
              </div>
              <div className="flex flex-col gap-4 p-6">
                <p className="ml-auto max-w-[85%] bg-[rgba(166,229,26,.1)] px-4 py-3 text-[13.5px] leading-relaxed text-[var(--ld-ink)]" style={{ borderRadius: 2 }}>
                  Por que minha performance caiu essa semana?
                </p>
                <p className="max-w-[92%] border-l-2 border-[var(--ld-lime)] bg-[rgba(232,234,230,.03)] px-4 py-3 text-[13.5px] leading-relaxed text-[var(--ld-dim)]">
                  Sua carga subiu 18% nos últimos 14 dias enquanto os indicadores de recuperação
                  caíram. A intensidade na bike também aumentou — três sessões acima do limiar em
                  oito dias.
                </p>
                <p className="ld-label px-1 text-[10px] text-[rgba(232,234,230,.3)]">
                  ↓ e isso chega no painel assim
                </p>
                <div className="border border-[var(--ld-line)] px-4 py-3" style={{ borderRadius: 2 }}>
                  <p className="ld-label text-[10px] text-[var(--ld-faint)]">Prontidão hoje</p>
                  <p className="mt-1.5 text-[13.5px] text-[var(--ld-ink)]">
                    Manter · aeróbico, sem intensidade.
                  </p>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ══ 05 · live panel ══ */}
      <section id="painel" className={SECTION_PAD}>
        <Reveal>
          <SectionLabel n="05">O painel ao vivo</SectionLabel>
        </Reveal>
        <Reveal delay={60}>
          <Headline className="mt-9">Uma central de performance.</Headline>
        </Reveal>
        <Reveal delay={140}>
          <div className="mt-12">
            <LivePanel days={days} weeks={weeks} restDays={restDays} />
          </div>
        </Reveal>

        {/* progression */}
        <Reveal delay={80}>
          <div className="mt-[104px]">
            <SectionLabel n="06">Progressão</SectionLabel>
          </div>
        </Reveal>
        <div className="mt-9 grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <Reveal delay={60}>
            <Headline>Ganhos pequenos, resultado que acumula.</Headline>
          </Reveal>
          <Reveal delay={140}>
            <p className="text-[15px] leading-[1.75] text-[var(--ld-dim)] lg:pt-3">
              Doze semanas de constância registrada — a mesma leitura, semana após semana, é o que
              separa treinar muito de treinar melhor.
            </p>
          </Reveal>
        </div>

        <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PROGRESS.map((p, i) => (
            <Reveal key={p.w} delay={i * 80}>
              <div className="h-full border border-[var(--ld-line)] bg-[rgba(232,234,230,.02)] p-6" style={{ borderRadius: 2 }}>
                <p className="ld-label text-[var(--ld-faint)]">{p.w}</p>
                <p className="ld-dsp mt-4 text-[44px] font-bold leading-none text-[var(--ld-lime)]">
                  <Counter to={p.ctl} />
                </p>
                <p className="ld-label mt-1.5 text-[10px] text-[rgba(232,234,230,.3)]">CTL</p>
                <p className="mt-4 border-t border-[var(--ld-line-soft)] pt-4 text-[12.5px] text-[var(--ld-dim)]">
                  {p.note}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ══ 07 · pricing ══ */}
      <section id="precos" className={SECTION_PAD}>
        <Reveal>
          <SectionLabel n="07">Preços</SectionLabel>
        </Reveal>
        <div className="mt-9 grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <Reveal delay={60}>
            <Headline>Para o atleta</Headline>
          </Reveal>
          <Reveal delay={140}>
            <p className="text-[15px] leading-[1.75] text-[var(--ld-dim)] lg:pt-3">
              Sem cobrança de IA por cima — você usa a assinatura que já tem.
            </p>
          </Reveal>
        </div>

        <div className="mt-12 grid gap-3 md:grid-cols-3">
          {PLANS.map((p, i) => (
            <Reveal key={p.tag} delay={i * 70}>
              <div
                className="flex h-full flex-col border bg-[rgba(232,234,230,.02)] p-7 transition-colors duration-300 hover:border-[var(--ld-lime)]"
                style={{
                  borderRadius: 2,
                  borderColor: p.featured ? "var(--ld-lime)" : "var(--ld-line)",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="ld-label text-[var(--ld-faint)]">{p.tag}</p>
                  {p.badge && (
                    <span
                      className="ld-label shrink-0 px-2.5 py-1 text-[9.5px]"
                      style={
                        p.featured
                          ? { background: "var(--ld-lime)", color: "var(--ld-bg)", borderRadius: 2 }
                          : { background: "rgba(46,211,183,.14)", color: "var(--ld-teal)", borderRadius: 2 }
                      }
                    >
                      {p.badge}
                    </span>
                  )}
                </div>
                <p className="ld-dsp mt-6 flex items-baseline gap-2">
                  <span className="text-[62px] font-bold leading-none text-[var(--ld-ink)]">{p.price}</span>
                  <span className="text-[14px] font-semibold tracking-[.1em] text-[var(--ld-faint)]">{p.per}</span>
                </p>
                <p className="mt-5 flex-1 text-[13.5px] leading-[1.7] text-[var(--ld-dim)]">{p.body}</p>
                <Link
                  href="/app"
                  className="ld-label mt-8 block border px-4 py-3.5 text-center text-[11.5px] transition-colors duration-300"
                  style={
                    p.featured
                      ? { background: "var(--ld-lime)", color: "var(--ld-bg)", borderColor: "var(--ld-lime)", borderRadius: 2 }
                      : { borderColor: "rgba(232,234,230,.22)", color: "var(--ld-ink)", borderRadius: 2 }
                  }
                >
                  {p.cta}
                </Link>
              </div>
            </Reveal>
          ))}
        </div>

        {/* agency */}
        <div className="mt-[104px] grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <Reveal>
            <Headline>Para a assessoria</Headline>
          </Reveal>
          <Reveal delay={80}>
            <p className="text-[15px] leading-[1.75] text-[var(--ld-dim)] lg:pt-3">
              Por aluno, e mais barato conforme você cresce. Treinador, nutricionista e
              fisioterapeuta entram no mesmo preço.
            </p>
          </Reveal>
        </div>

        <div className="mt-12 grid gap-3 lg:grid-cols-[1fr_1.05fr]">
          <Reveal delay={60}>
            <div className="h-full border border-[var(--ld-line)]" style={{ borderRadius: 2 }}>
              {TIER_ROWS.map((t, i) => (
                <div
                  key={t.r}
                  className={`flex items-center justify-between gap-4 px-6 py-[22px] ${
                    i < TIER_ROWS.length - 1 ? "border-b border-[var(--ld-line-soft)]" : ""
                  }`}
                >
                  <span className="text-[14px] text-[var(--ld-dim)]">{t.r}</span>
                  <span className="ld-dsp text-[26px] font-bold leading-none text-[var(--ld-lime)]">{t.p}</span>
                </div>
              ))}
            </div>
          </Reveal>
          <Reveal delay={130}>
            <PriceCalc />
          </Reveal>
        </div>
      </section>

      {/* ══ 08 · close ══ */}
      <section id="final" className={`${SECTION_PAD} text-center`}>
        <Reveal>
          <p className="ld-label text-[12px] tracking-[.3em] text-[var(--ld-faint)]">
            Train. Track. <span className="text-[var(--ld-lime)]">Evolve.</span>
          </p>
        </Reveal>
        <Reveal delay={80}>
          <h2 className="ld-dsp mx-auto mt-8 max-w-[16ch] text-balance text-[clamp(38px,7vw,96px)] font-bold leading-[.95] tracking-[-.01em] text-[var(--ld-ink)]">
            Pare de colecionar dado.
            <br />
            <span className="text-[var(--ld-lime)]">Comece a usar.</span>
          </h2>
        </Reveal>
        <Reveal delay={160}>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/app"
              className="ld-label flex items-center gap-3 px-8 py-4 text-[12px]"
              style={{ background: "var(--ld-lime)", color: "var(--ld-bg)", borderRadius: 2 }}
            >
              Entrar como atleta <span aria-hidden>→</span>
            </Link>
            <Link
              href="/coach"
              className="ld-label border border-[rgba(232,234,230,.22)] px-8 py-4 text-[12px] text-[var(--ld-ink)] transition-colors duration-300 hover:border-[var(--ld-lime)] hover:text-[var(--ld-lime)]"
              style={{ borderRadius: 2 }}
            >
              Entrar como assessoria
            </Link>
          </div>
        </Reveal>
      </section>

      <footer className="relative z-[2] border-t border-[var(--ld-line)]">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-6 px-[22px] py-10 sm:px-10">
          <span className="ld-label text-[11px] tracking-[.3em] text-[var(--ld-faint)]">
            Every metric matters.
          </span>
          <span className="text-[11.5px] text-[rgba(232,234,230,.28)]">
            © 2026 MY TRAKR — painel de treino multiesporte
          </span>
        </div>
      </footer>
    </div>
  );
}
