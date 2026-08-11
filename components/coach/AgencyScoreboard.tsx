"use client";

// O placar da assessoria: uma barra por profissional, com a métrica trocável.
//
// A forma vem do dashboard que o Rafael já usa no aluguel de bikes ("Produção
// por vendedor" com abas). Ela é certa aqui pelo mesmo motivo que é lá: "quem
// produz mais" tem resposta diferente conforme o que se mede, e ver as MESMAS
// barras reordenarem ensina a relação entre as métricas — coisa que quatro
// gráficos lado a lado não fazem.
import { useState } from "react";
import Link from "next/link";
import { rankBy, type CoachScore, type RankMetric } from "@/lib/agency-metrics";
import { translator, type Locale, type TKey } from "@/lib/i18n";

const METRICS: { key: RankMetric; label: TKey; kind: "count" | "money" | "ratio" }[] = [
  { key: "athletes",       label: "agency.m.athletes",   kind: "count" },
  { key: "revenue",        label: "agency.m.revenue",    kind: "money" },
  { key: "margin",         label: "agency.m.margin",     kind: "money" },
  { key: "healthy",        label: "agency.m.healthy",    kind: "ratio" },
  { key: "load",           label: "agency.m.load",       kind: "ratio" },
  { key: "revenueAtRisk",  label: "agency.m.atRisk",     kind: "money" },
  { key: "costPerAthlete", label: "agency.m.costPer",    kind: "money" },
];

function fmt(v: number | null, kind: "count" | "money" | "ratio", currency: string): string {
  if (v == null) return "—";
  if (kind === "ratio") return `${Math.round(v * 100)}%`;
  if (kind === "money") return `${currency} ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return String(v);
}

export function AgencyScoreboard({
  rows,
  rollup,
  currency,
  locale,
}: {
  rows: CoachScore[];
  rollup: { athletes: number; revenue: number; margin: number | null; costKnown: boolean; atRisk: number; unpriced: number };
  currency: string;
  locale: Locale;
}) {
  const tr = translator(locale);
  const [metric, setMetric] = useState<RankMetric>("athletes");
  const active = METRICS.find((m) => m.key === metric)!;
  const ranked = rankBy(rows, metric);

  // Escala a partir do maior valor CONHECIDO. Um null não é zero, então ele não
  // pode encolher nem esticar a régua dos outros.
  const max = Math.max(...ranked.map((r) => Math.abs(r[metric] ?? 0)), 0) || 1;

  return (
    <section className="mb-6 rounded-[16px] border border-[var(--border-soft)] bg-[var(--surface)] p-4 sm:p-5">
      {/* Topo: o resumo que o dono lê primeiro. */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label={tr("agency.k.athletes")} value={String(rollup.athletes)} />
        <Kpi label={tr("agency.k.revenue")} value={fmt(rollup.revenue, "money", currency)} />
        <Kpi
          label={tr("agency.k.margin")}
          value={fmt(rollup.margin, "money", currency)}
          // Um traço aqui não é "zero", é "ninguém declarou como paga" — e a
          // legenda diz isso, senão o dono lê como prejuízo.
          hint={rollup.costKnown ? undefined : tr("agency.k.marginUnknown")}
        />
        <Kpi label={tr("agency.k.atRisk")} value={String(rollup.atRisk)} tone={rollup.atRisk > 0 ? "warn" : undefined} />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetric(m.key)}
              className={`rounded-full px-3 py-[5px] text-[12px] font-semibold transition-colors ${
                m.key === metric
                  ? "bg-[var(--surface-3)] text-[var(--text)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {tr(m.label)}
            </button>
          ))}
        </div>
        <span className="text-[11.5px] text-[var(--text-faint)]">{tr("agency.rank.hint")}</span>
      </div>

      <ul className="flex flex-col gap-1.5">
        {ranked.map((r) => {
          const v = r[metric];
          const pct = v == null ? 0 : Math.min(100, (Math.abs(v) / max) * 100);
          const negative = typeof v === "number" && v < 0;
          return (
            <li key={r.staffId}>
              <Link
                href={`/coach/agency/${r.staffId}`}
                className="grid grid-cols-[minmax(84px,132px)_1fr_auto] items-center gap-3 rounded-[10px] px-1.5 py-1.5 transition-colors hover:bg-[var(--surface-2)]"
              >
                <span className="truncate text-[12.5px] font-medium text-[var(--text)]">{r.name}</span>
                <span className="h-[10px] overflow-hidden rounded-full bg-[var(--surface-3)]">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      // Vermelho só para margem negativa — o único caso em que a
                      // direção do número muda o que ele significa.
                      background: negative ? "var(--bad)" : "var(--lime)",
                    }}
                  />
                </span>
                <span
                  className={`w-[92px] text-right text-[12.5px] tabular-nums ${
                    v == null ? "text-[var(--text-faint)]" : negative ? "text-[var(--bad)]" : "text-[var(--text)]"
                  }`}
                >
                  {fmt(v, active.kind, currency)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      {rollup.unpriced > 0 && (
        <p className="mt-3 text-[11.5px] text-[var(--text-faint)]">
          {tr("agency.unpriced").replace("{n}", String(rollup.unpriced))}
        </p>
      )}
    </section>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warn" }) {
  return (
    <div className="rounded-[12px] border border-[var(--border-soft)] bg-[var(--surface-2)] px-3 py-2.5">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-[var(--text-faint)]">{label}</p>
      <p className={`mt-0.5 text-[19px] font-extrabold ${tone === "warn" ? "text-[var(--warn)]" : "text-[var(--text)]"}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[10.5px] leading-tight text-[var(--text-faint)]">{hint}</p>}
    </div>
  );
}
