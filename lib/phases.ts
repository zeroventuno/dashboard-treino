// One palette for training phases, keyed by NAME.
//
// It used to be assigned by POSITION — `colors[i % 4]` as the phases were laid
// out — which is wrong in two ways that both showed up on a real season.
//
// A periodisation that repeats a block (Base, Build, Base, Build, Peak, Taper)
// gave the SAME phase a different colour each time it came round, while the
// legend, which dedupes by name, showed only the last one. And with four
// colours cycling, a fifth phase silently reused the first — so Race came back
// as Base's teal.
//
// Keyed by name, a phase looks the same everywhere it appears: in the season
// bars, in its legend, and in the coach's workout bank.

/** Canonical hue per phase. */
export const PHASE_COLORS = {
  base: "var(--phase-base)",
  build: "var(--phase-build)",
  peak: "var(--phase-peak)",
  taper: "var(--phase-taper)",
  race: "var(--phase-race)",
} as const;

/** Matched loosely: the coach names phases in their own language, and this has
 * to recognise "Construção" and "Costruzione" as the same thing as "Build". */
const MATCHERS: [RegExp, string][] = [
  [/base|fond/i, PHASE_COLORS.base],
  [/build|constru|costru|desarrollo|développ|aufbau/i, PHASE_COLORS.build],
  [/peak|pico|picco|pointe|spitze/i, PHASE_COLORS.peak],
  [/taper|polim|scarico|affût|afin/i, PHASE_COLORS.taper],
  [/race|prova|gara|carrera|course|wettkampf/i, PHASE_COLORS.race],
];

/** Fallback for a phase whose name we don't recognise. Distinct from all five
 * canonical hues so an unnamed block reads as "something else" rather than
 * impersonating Base. */
const UNKNOWN = "var(--strength)";

/**
 * The colour for a phase, from its name.
 *
 * `stored` wins when present — the phases TABLE (race-mode athletes) can carry
 * one, and it is not this file's place to override a colour someone chose. A
 * cycle's phases have no colour field at all: set_cycle only stores name, weeks
 * and focus, which is exactly why this map exists.
 */
export function phaseColor(name: string, stored?: string | null): string {
  if (stored) return stored;
  return MATCHERS.find(([re]) => re.test(name))?.[1] ?? UNKNOWN;
}
