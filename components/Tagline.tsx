"use client";

import { useEffect, useState } from "react";

const TAGLINES = [
  "Train. Track. Evolve.",
  "Every Metric Matters.",
  "Your Performance, Connected.",
  "From Data to Performance.",
  "The Athlete's Dashboard.",
];

/** Splits off the last word so it can be highlighted in lime, matching the
 * original "Train. Track. Evolve." styling where only the last word pops. */
function splitLast(phrase: string): [string, string] {
  const i = phrase.trim().lastIndexOf(" ");
  return i === -1 ? ["", phrase] : [phrase.slice(0, i + 1), phrase.slice(i + 1)];
}

export function Tagline() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % TAGLINES.length), 5000);
    return () => clearInterval(id);
  }, []);

  const [rest, last] = splitLast(TAGLINES[i]);
  return (
    <p key={i} className="fade dsp text-[15px] font-extrabold uppercase tracking-[0.3em] text-[var(--text-muted)]">
      {rest}
      <span className="text-[var(--lime)]">{last}</span>
    </p>
  );
}
