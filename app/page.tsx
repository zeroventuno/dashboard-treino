// ────────────────────────────────────────────────────────────────────────────
//  The landing page — mytrakr.fit
//
//  Provisional in copy, not in craft: the layout, motion and design system are
//  meant to survive, only the words should churn. Written in Portuguese for now
//  because .com.br is the first target market; every string sits in this file
//  rather than lib/i18n.ts on purpose — marketing copy changes weekly, and
//  putting it in the TYPED dictionary would break the build in five languages
//  every time a headline is reworded. Translating later is mechanical.
//
//  All motion is CSS + one IntersectionObserver. No animation library: this page
//  is the first thing a prospect loads, often on a phone on mobile data.
// ────────────────────────────────────────────────────────────────────────────

import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Reveal } from "@/components/landing/Reveal";
import { PriceCalc } from "@/components/landing/PriceCalc";

export const metadata: Metadata = {
  title: "MY TRAKR — o painel de treino que se preenche sozinho",
  description:
    "Para o atleta: conecte a sua IA e o seu relógio, e o painel se escreve sozinho. Para a assessoria: gerencie 100 alunos com o cuidado que hoje você dá a 30.",
};

// ── Hero mark ───────────────────────────────────────────────────────────────

/** The logo's four bars, breathing left to right. */
function Bars({ className = "" }: { className?: string }) {
  const bars = [
    { h: 26, d: 0 },
    { h: 52, d: 0.2 },
    { h: 78, d: 0.4 },
    { h: 100, d: 0.6 },
  ];
  return (
    <span className={`inline-flex items-end gap-[5px] ${className}`} aria-hidden>
      {bars.map((b, i) => (
        <span
          key={i}
          className="ld-bar block w-[9px] rounded-[2px] bg-[var(--brand-lime)]"
          style={{ height: `${b.h}%`, animationDelay: `${b.d}s` }}
        />
      ))}
    </span>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────────

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-[var(--brand-lime)]">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--brand-lime)]" />
      {children}
    </p>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand-lime)]" />
      <span>
        <span className="text-[13.5px] font-bold text-[var(--text)]">{title}</span>
        <span className="block text-[13px] leading-relaxed text-[var(--text-muted)]">{body}</span>
      </span>
    </li>
  );
}

// ── The product, drawn rather than screenshotted ────────────────────────────
// Real screenshots would date instantly and leak whichever athlete's data was
// on screen. This is the same design system, so it stays honest.

const WEEK = [
  { d: "S", h: 46, c: "var(--swim)" },
  { d: "T", h: 72, c: "var(--bike)" },
  { d: "Q", h: 34, c: "var(--run)" },
  { d: "Q", h: 88, c: "var(--bike)" },
  { d: "S", h: 28, c: "var(--strength)" },
  { d: "S", h: 100, c: "var(--bike)" },
  { d: "D", h: 62, c: "var(--run)" },
];

function ProductMock() {
  const r = 34;
  const c = 2 * Math.PI * r;
  const pct = 87;

  return (
    <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
      {/* week volume */}
      <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-faint)]">
          Sua semana
        </p>
        <div className="mt-3 flex h-[96px] items-end gap-2">
          {WEEK.map((b, i) => (
            <span key={i} className="flex flex-1 flex-col items-center gap-1.5">
              <span
                className="ld-grow w-full rounded-[3px]"
                style={{ height: `${b.h}%`, background: b.c, animationDelay: `${i * 70}ms` }}
              />
              <span className="text-[9px] font-bold text-[var(--text-faint)]">{b.d}</span>
            </span>
          ))}
        </div>
      </div>

      {/* adherence */}
      <div className="flex flex-col items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-4">
        <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden>
          <circle cx="44" cy="44" r={r} fill="none" stroke="var(--border)" strokeWidth="8" />
          <circle
            cx="44"
            cy="44"
            r={r}
            fill="none"
            stroke="var(--good)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={c}
            className="ld-draw"
            transform="rotate(-90 44 44)"
            style={
              {
                strokeDashoffset: c * (1 - pct / 100),
                "--dash": `${c}px`,
                "--dash-end": `${c * (1 - pct / 100)}px`,
              } as React.CSSProperties
            }
          />
          <text x="44" y="44" dy="0.35em" textAnchor="middle" className="dsp" style={{ fontSize: 22, fontWeight: 800, fill: "var(--good)" }}>
            {pct}
          </text>
        </svg>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-faint)]">
          Adesão
        </p>
      </div>

      {/* zone comparison — the thing nothing else shows */}
      <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:col-span-2">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-faint)]">
          Tempo em zona · prescrito / feito
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {[
            { z: "Z2", p: 100, a: 96, col: "var(--good)" },
            { z: "Z4", p: 62, a: 24, col: "var(--warn)" },
          ].map((row) => (
            <div key={row.z} className="grid grid-cols-[24px_1fr] items-center gap-3">
              <span className="text-[11px] font-bold" style={{ color: row.col }}>{row.z}</span>
              <span className="flex flex-col gap-[3px]">
                <span className="h-[6px] rounded-full border" style={{ width: `${row.p}%`, borderColor: row.col }} />
                <span className="ld-grow h-[6px] rounded-full" style={{ width: `${row.a}%`, background: row.col, transformOrigin: "left" }} />
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-[11px] text-[var(--text-muted)]">
          <span className="font-bold text-[var(--warn)]">−22min Z4</span> a menos do que foi pedido
        </p>
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  return (
    <div className="relative overflow-hidden">
      {/* drifting blooms */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div
          className="ld-drift absolute -left-[10%] -top-[20%] h-[70vh] w-[70vw] rounded-full opacity-[0.16] blur-[110px]"
          style={{ background: "radial-gradient(circle, var(--brand-lime), transparent 62%)" }}
        />
        <div
          className="ld-drift-slow absolute -right-[15%] top-[35%] h-[65vh] w-[65vw] rounded-full opacity-[0.12] blur-[120px]"
          style={{ background: "radial-gradient(circle, var(--teal), transparent 62%)" }}
        />
      </div>

      {/* ── nav ── */}
      <nav className="sticky top-0 z-50 border-b border-[var(--border-soft)] bg-[color-mix(in_oklab,var(--bg)_82%,transparent)] backdrop-blur-lg">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <span className="flex items-center gap-2.5">
            <Bars className="h-[22px]" />
            <span className="dsp text-[17px] font-extrabold tracking-tight text-[var(--text)]">MY TRAKR</span>
          </span>
          <div className="flex items-center gap-2">
            <Link
              href="/app"
              className="rounded-full border border-[var(--border)] px-3.5 py-[7px] text-[12.5px] font-semibold text-[var(--text-2)] transition-colors hover:border-[var(--brand-lime)] hover:text-[var(--text)]"
            >
              Atleta
            </Link>
            <Link
              href="/coach"
              className="rounded-full bg-[var(--brand-lime)] px-3.5 py-[7px] text-[12.5px] font-bold text-black transition-opacity hover:opacity-90"
            >
              Assessoria
            </Link>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-[1180px] px-4 sm:px-6">
        {/* ── hero ── */}
        <section className="flex flex-col items-center pb-16 pt-16 text-center sm:pt-24">
          <Reveal>
            {/* next/image, not <img>: the source is a 2 MB PNG and this is the
                first thing a prospect loads, often on mobile data. Served as
                AVIF/WebP at the size actually needed, it lands around 60 KB.
                `priority` because it IS the hero — lazy-loading it would show an
                empty page for the first paint. */}
            <Image
              src="/logo-rabisco.png"
              alt="MY TRAKR"
              width={1536}
              height={1024}
              priority
              sizes="(max-width: 640px) 92vw, 560px"
              className="mx-auto h-auto w-full max-w-[560px] drop-shadow-[0_0_60px_rgba(178,230,58,0.18)]"
            />
          </Reveal>

          <Reveal delay={120}>
            <h1 className="dsp mx-auto mt-6 max-w-[19ch] text-balance text-[38px] font-extrabold leading-[1.05] tracking-tight sm:text-[58px]">
              <span className="ld-sweep">O painel de treino</span>
              <br />
              <span className="text-[var(--text)]">que se preenche sozinho.</span>
            </h1>
          </Reveal>

          <Reveal delay={220}>
            <p className="mx-auto mt-5 max-w-[52ch] text-balance text-[15.5px] leading-relaxed text-[var(--text-muted)] sm:text-[17px]">
              Conecte a <strong className="font-semibold text-[var(--text-2)]">sua IA</strong> e o
              seu relógio. Ela lê o seu painel, escreve os seus treinos e conversa com você — enquanto
              os números chegam sozinhos do pulso.
            </p>
          </Reveal>

          <Reveal delay={300}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a
                href="#precos"
                className="rounded-full bg-[var(--brand-lime)] px-6 py-3 text-[14px] font-bold text-black shadow-[0_8px_30px_rgba(178,230,58,0.25)] transition-transform hover:scale-[1.03]"
              >
                Ver planos
              </a>
              <a
                href="#assessoria"
                className="rounded-full border border-[var(--border)] px-6 py-3 text-[14px] font-semibold text-[var(--text-2)] transition-colors hover:border-[var(--brand-lime)] hover:text-[var(--text)]"
              >
                Sou assessoria
              </a>
            </div>
          </Reveal>

          <Reveal delay={380} className="w-full">
            <div className="mx-auto mt-14 w-full max-w-[860px] text-left">
              <ProductMock />
            </div>
          </Reveal>
        </section>

        {/* ── the two worlds ── */}
        <section className="border-t border-[var(--border-soft)] py-16 sm:py-24">
          <Reveal>
            <Eyebrow>Duas ferramentas, um núcleo</Eyebrow>
            <h2 className="dsp mt-3 max-w-[20ch] text-balance text-[30px] font-extrabold leading-tight tracking-tight text-[var(--text)] sm:text-[42px]">
              O atleta tem a IA dele. A assessoria tem a equipe dela.
            </h2>
          </Reveal>

          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            <Reveal delay={80}>
              <div className="ld-card h-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-7">
                <Eyebrow>Para o atleta</Eyebrow>
                <h3 className="dsp mt-3 text-[22px] font-extrabold text-[var(--text)]">
                  Traga a sua própria IA
                </h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                  Um conector liga o Claude ou o ChatGPT que você já usa ao seu painel. Você conversa,
                  ela escreve — treinos, check-in, ajustes. Nada de mais uma assinatura de IA.
                </p>
                <ul className="mt-5 flex flex-col gap-3.5">
                  <Feature
                    title="Conector para a sua IA"
                    body="Ela lê o histórico e escreve o plano. Sua chave, seu chat, seu painel."
                  />
                  <Feature
                    title="Check-in diário com farol"
                    body="Sono, HRV, energia e dor viram verde, amarelo ou vermelho — e o dia se ajusta."
                  />
                  <Feature
                    title="Relógio conectado"
                    body="Garmin, Coros, Polar e Suunto chegam pelo Strava. Ou suba o .fit e leia até tempo de contato no solo."
                  />
                  <Feature
                    title="Tempo em zona, não só tempo"
                    body="Uma hora fácil quando o treino pedia limiar não vale 100. Aqui isso aparece."
                  />
                  <Feature
                    title="Arquivos prontos para o treino"
                    body=".zwo para o rolo, .fit para o relógio. Sem redigitar bloco por bloco."
                  />
                  <Feature
                    title="Condicionamento, zonas e corpo"
                    body="Forma e fadiga, zonas de potência e pace, composição corporal, plano alimentar e lesões."
                  />
                </ul>
              </div>
            </Reveal>

            <Reveal delay={160}>
              <div className="ld-card h-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-7">
                <Eyebrow>Para a assessoria</Eyebrow>
                <h3 className="dsp mt-3 text-[22px] font-extrabold text-[var(--text)]">
                  Atenda 100 como atende 30
                </h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                  O treino continua sendo seu. A ferramenta cuida do que consome a sua semana: quem
                  precisa de atenção hoje, o que prescrever para trinta pessoas de uma vez, e onde a
                  carteira está escorrendo.
                </p>
                <ul className="mt-5 flex flex-col gap-3.5">
                  <Feature
                    title="Carteira ordenada por atenção"
                    body="Quem despencou aparece primeiro. Não é foto do mês — é a queda das últimas duas semanas."
                  />
                  <Feature
                    title="Banco de treinos com a sua metodologia"
                    body="Monte, marque com tags por fase e esporte, e gere novos com IA a partir do seu próprio método."
                  />
                  <Feature
                    title="Prescrição em lote"
                    body="Um treino do banco para todos os alunos em fase de build, respeitando o volume de cada um."
                  />
                  <Feature
                    title="Treinador, nutri e fisio"
                    body="Cada profissional com a sua visão. O dono vê tudo — inclusive o valor mensal em risco."
                  />
                  <Feature
                    title="Prescrito × executado"
                    body="Volta por volta, zona por zona. Você vê que fez a hora e não fez a intensidade."
                  />
                  <Feature
                    title="Disponibilidade do aluno"
                    body="Ele diz os dias e as horas que tem. Treino coletivo cai no dia em que todo mundo pode."
                  />
                </ul>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── pricing ── */}
        <section id="precos" className="scroll-mt-20 border-t border-[var(--border-soft)] py-16 sm:py-24">
          <Reveal>
            <Eyebrow>Preços</Eyebrow>
            <h2 className="dsp mt-3 text-[30px] font-extrabold leading-tight tracking-tight text-[var(--text)] sm:text-[42px]">
              Para o atleta
            </h2>
            <p className="mt-2 max-w-[54ch] text-[14px] leading-relaxed text-[var(--text-muted)]">
              Sem cobrança de IA por cima — você usa a assinatura que já tem.
            </p>
          </Reveal>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <Reveal delay={60}>
              <div className="ld-card relative h-full overflow-hidden rounded-[var(--radius)] border-2 border-[var(--brand-lime)] bg-[var(--surface)] p-6">
                <span className="absolute right-4 top-4 rounded-full bg-[var(--brand-lime)] px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-black">
                  Fundador
                </span>
                <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--brand-lime)]">
                  Quem entra agora
                </p>
                <p className="dsp mt-3 flex items-baseline gap-1.5">
                  <span className="text-[46px] font-extrabold leading-none text-[var(--text)]">€7</span>
                  <span className="text-[14px] font-semibold text-[var(--text-muted)]">/mês</span>
                </p>
                <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-muted)]">
                  Preço travado enquanto você for assinante. Tudo o que o plano normal tem, e o que
                  vier depois.
                </p>
                <Link
                  href="/app"
                  className="mt-6 block rounded-full bg-[var(--brand-lime)] px-4 py-2.5 text-center text-[13.5px] font-bold text-black transition-opacity hover:opacity-90"
                >
                  Quero o preço de fundador
                </Link>
              </div>
            </Reveal>

            <Reveal delay={130}>
              <div className="ld-card h-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-6">
                <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--text-faint)]">
                  Mensal
                </p>
                <p className="dsp mt-3 flex items-baseline gap-1.5">
                  <span className="text-[46px] font-extrabold leading-none text-[var(--text)]">€15</span>
                  <span className="text-[14px] font-semibold text-[var(--text-muted)]">/mês</span>
                </p>
                <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-muted)]">
                  O painel completo, sem compromisso de prazo. Cancele quando quiser.
                </p>
                <Link
                  href="/app"
                  className="mt-6 block rounded-full border border-[var(--border)] px-4 py-2.5 text-center text-[13.5px] font-semibold text-[var(--text-2)] transition-colors hover:border-[var(--brand-lime)] hover:text-[var(--text)]"
                >
                  Começar
                </Link>
              </div>
            </Reveal>

            <Reveal delay={200}>
              <div className="ld-card h-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-6">
                <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.14em] text-[var(--teal)]">
                  Anual
                  <span className="rounded-full bg-[color-mix(in_oklab,var(--teal)_18%,transparent)] px-2 py-[3px] text-[9.5px] tracking-normal">
                    2 meses grátis
                  </span>
                </p>
                <p className="dsp mt-3 flex items-baseline gap-1.5">
                  <span className="text-[46px] font-extrabold leading-none text-[var(--text)]">€150</span>
                  <span className="text-[14px] font-semibold text-[var(--text-muted)]">/ano</span>
                </p>
                <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-muted)]">
                  Paga dez meses, usa doze. Dá <span className="font-semibold text-[var(--text-2)]">€12,50</span> por mês.
                </p>
                <Link
                  href="/app"
                  className="mt-6 block rounded-full border border-[var(--border)] px-4 py-2.5 text-center text-[13.5px] font-semibold text-[var(--text-2)] transition-colors hover:border-[var(--teal)] hover:text-[var(--text)]"
                >
                  Assinar o ano
                </Link>
              </div>
            </Reveal>
          </div>

          {/* B2B */}
          <div id="assessoria" className="scroll-mt-20 pt-16 sm:pt-24">
            <Reveal>
              <Eyebrow>Assessorias</Eyebrow>
              <h2 className="dsp mt-3 text-[30px] font-extrabold leading-tight tracking-tight text-[var(--text)] sm:text-[42px]">
                Por aluno, e mais barato conforme você cresce
              </h2>
              <p className="mt-2 max-w-[54ch] text-[14px] leading-relaxed text-[var(--text-muted)]">
                Sem taxa por profissional. Treinador, nutricionista e fisioterapeuta entram todos no
                mesmo preço.
              </p>
            </Reveal>

            <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
              <Reveal delay={60}>
                <div className="h-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-2">
                  {[
                    { r: "1 – 10 alunos", p: "€10", s: "por aluno / mês" },
                    { r: "11 – 50 alunos", p: "€9", s: "por aluno / mês" },
                    { r: "51 – 100 alunos", p: "€8", s: "por aluno / mês" },
                    { r: "Acima de 100", p: "Fale com a gente", s: "" },
                  ].map((t, i, arr) => (
                    <div
                      key={t.r}
                      className={`flex items-center justify-between gap-4 px-4 py-4 ${
                        i < arr.length - 1 ? "border-b border-[var(--border-soft)]" : ""
                      }`}
                    >
                      <span className="text-[13.5px] font-semibold text-[var(--text-2)]">{t.r}</span>
                      <span className="text-right">
                        <span className="dsp block text-[22px] font-extrabold leading-none text-[var(--brand-lime)]">
                          {t.p}
                        </span>
                        {t.s && <span className="text-[10.5px] text-[var(--text-faint)]">{t.s}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </Reveal>

              <Reveal delay={130}>
                <PriceCalc />
              </Reveal>
            </div>
          </div>
        </section>

        {/* ── closing ── */}
        <section className="border-t border-[var(--border-soft)] py-16 text-center sm:py-24">
          <Reveal>
            <Bars className="mx-auto h-[34px]" />
            <h2 className="dsp mx-auto mt-6 max-w-[22ch] text-balance text-[28px] font-extrabold leading-tight tracking-tight text-[var(--text)] sm:text-[38px]">
              Todo dado importa. Se ninguém lê, nenhum importa.
            </h2>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/app"
                className="rounded-full bg-[var(--brand-lime)] px-6 py-3 text-[14px] font-bold text-black transition-transform hover:scale-[1.03]"
              >
                Entrar como atleta
              </Link>
              <Link
                href="/coach"
                className="rounded-full border border-[var(--border)] px-6 py-3 text-[14px] font-semibold text-[var(--text-2)] transition-colors hover:border-[var(--brand-lime)] hover:text-[var(--text)]"
              >
                Entrar como assessoria
              </Link>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-[var(--border-soft)] py-8">
        <div className="mx-auto flex max-w-[1180px] flex-col items-center gap-2 px-4 text-center sm:px-6">
          <span className="dsp text-[13px] font-extrabold uppercase tracking-[0.3em] text-[var(--text-faint)]">
            Train. Track. <span className="text-[var(--brand-lime)]">Evolve.</span>
          </span>
          <p className="text-[11px] text-[var(--text-faint)]">
            MY TRAKR · painel de treino multiesporte
          </p>
        </div>
      </footer>
    </div>
  );
}
