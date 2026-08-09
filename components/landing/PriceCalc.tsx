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
// contradiction to every prospect who dragged the slider past 50.
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
  const [athletes, setAthletes] = useState(31);
  const { total, lines, perAthlete } = quote(athletes);

  return (
    <div className="border border-[var(--ld-line)] bg-[rgba(232,234,230,.02)] p-6 sm:p-8" style={{ borderRadius: 2 }}>
      <p className="ld-label text-[var(--ld-faint)]">Sua assessoria</p>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-5">
        <p className="ld-dsp text-[64px] font-bold leading-[.9] text-[var(--ld-lime)] tabular-nums sm:text-[76px]">
          €{total}
        </p>
        <p className="ld-dsp pb-1 text-right text-[13px] font-semibold tracking-[.14em] text-[var(--ld-faint)]">
          <span className="text-[var(--ld-ink)]">{athletes}</span> alunos
          <br />
          <span className="text-[var(--ld-ink)]">€{perAthlete.toFixed(2).replace(".", ",")}</span> por aluno
        </p>
      </div>

      <input
        type="range"
        min={1}
        max={MAX}
        value={athletes}
        onChange={(e) => setAthletes(Number(e.target.value))}
        aria-label="Número de alunos"
        className="ld-range mt-7 w-full"
      />

      <div className="mt-7 flex flex-col gap-2 border-t border-[var(--ld-line-soft)] pt-5">
        {lines.map((l) => (
          <div key={l.label} className="flex items-baseline justify-between text-[12.5px]">
            <span className="text-[var(--ld-faint)]">
              {l.label}
              <span className="ml-2 text-[rgba(232,234,230,.28)]">
                {l.count} aluno{l.count > 1 ? "s" : ""}
              </span>
            </span>
            <span className="ld-dsp text-[13px] font-semibold tracking-[.06em] text-[var(--ld-dim)] tabular-nums">
              {l.count} × €{l.price} = €{l.count * l.price}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-5 text-[12px] leading-relaxed text-[rgba(232,234,230,.35)]">
        Cada faixa vale só para os alunos dela — os 10 primeiros a €10, os seguintes a €9, e assim por
        diante. Crescer nunca aumenta o preço por aluno.
        {athletes === MAX && " Acima de 100, falamos com você."}
      </p>
    </div>
  );
}
