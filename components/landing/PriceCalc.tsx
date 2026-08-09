"use client";

// The agency price, worked out live.
//
// Pricing is GRADUATED, not flat-per-tier: the first ten athletes cost €10 each,
// the next forty €9, the rest €8. That distinction is the whole reason this
// component computes instead of multiplying.
//
// With flat tiers — everyone billed at the rate their headcount lands in — the
// bill goes DOWN as an agency grows: 50 athletes at €9 is €450, and the 51st
// pushes the whole book to €8, billing €408. Signing one more client would cost
// the agency's supplier €42, and a calculator on a public page would show that
// contradiction to every prospect who moved the slider past 50.
import { useState } from "react";

interface Tier {
  /** Last athlete covered by this rate. */
  upTo: number;
  price: number;
  label: string;
}

const TIERS: Tier[] = [
  { upTo: 10, price: 10, label: "1 – 10" },
  { upTo: 50, price: 9, label: "11 – 50" },
  { upTo: 100, price: 8, label: "51 – 100" },
];

const MAX = 100;

/** Monthly total plus the per-tier split, so the number is never a black box. */
function quote(athletes: number) {
  let remaining = athletes;
  let previous = 0;
  let total = 0;
  const lines: { label: string; count: number; price: number }[] = [];

  for (const tier of TIERS) {
    const capacity = tier.upTo - previous;
    const count = Math.max(0, Math.min(remaining, capacity));
    if (count > 0) {
      total += count * tier.price;
      lines.push({ label: tier.label, count, price: tier.price });
      remaining -= count;
    }
    previous = tier.upTo;
  }

  return { total, lines, perAthlete: athletes > 0 ? total / athletes : 0 };
}

export function PriceCalc() {
  const [athletes, setAthletes] = useState(25);
  const { total, lines, perAthlete } = quote(athletes);

  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--text-faint)]">
            Sua assessoria
          </p>
          <p className="dsp mt-1 text-[34px] font-extrabold leading-none text-[var(--text)]">
            {athletes} <span className="text-[18px] font-bold text-[var(--text-muted)]">alunos</span>
          </p>
        </div>
        <div className="text-right">
          <p className="dsp text-[40px] font-extrabold leading-none text-[var(--brand-lime)] tabular-nums">
            €{total}
          </p>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
            por mês · €{perAthlete.toFixed(2)} por aluno
          </p>
        </div>
      </div>

      <input
        type="range"
        min={1}
        max={MAX}
        value={athletes}
        onChange={(e) => setAthletes(Number(e.target.value))}
        aria-label="Número de alunos"
        className="ld-range mt-6 w-full"
      />

      <div className="mt-5 flex flex-col gap-1.5 border-t border-[var(--border-soft)] pt-4">
        {lines.map((l) => (
          <div key={l.label} className="flex items-baseline justify-between text-[12.5px]">
            <span className="text-[var(--text-muted)]">
              {l.label} <span className="text-[var(--text-faint)]">· {l.count} aluno{l.count > 1 ? "s" : ""}</span>
            </span>
            <span className="tabular-nums font-semibold text-[var(--text-2)]">
              {l.count} × €{l.price} = €{l.count * l.price}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-4 text-[11.5px] leading-relaxed text-[var(--text-faint)]">
        Cada faixa vale só para os alunos dela — os 10 primeiros a €10, os seguintes a €9, e assim por
        diante. Crescer nunca aumenta o preço por aluno.
        {athletes === MAX && " Acima de 100, falamos com você."}
      </p>
    </div>
  );
}
