// ────────────────────────────────────────────────────────────────────────────
//  Workout-bank tags — the classification layer over the agency's library.
//
//  `sport` and `phase` are already columns, so tags carry what they don't: the
//  focus of the session (energy system, shape, purpose, context). At 20 workouts
//  a bank browses fine; at 500 it's only usable if you can ask "show me the
//  threshold bike intervals I can do indoors".
//
//  Free-form tags are allowed — a coach's own vocabulary is part of their
//  method — but everything is normalized to lowercase kebab-case so `VO2 Max`,
//  `vo2max` and `VO2-Max` don't become three different filters. The suggested
//  vocabulary below is what the AI is told to prefer (n8n prompt and the
//  add_bank_workout tool description), which keeps a generated bank coherent.
// ────────────────────────────────────────────────────────────────────────────

/** lowercase, kebab-case, no accents/punctuation — one tag, one spelling. */
export function normalizeTag(raw: string): string {
  const kebab = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  // Snap to the vocabulary when only the separators differ, so "VO2 Max",
  // "vo2-max" and "vo2max" end up as ONE filter instead of three. A coach's own
  // term (no vocabulary match) simply stays kebab-case.
  const compact = kebab.replace(/-/g, "");
  return SUGGESTED_TAGS.find((t) => t.replace(/-/g, "") === compact) ?? kebab;
}

export function normalizeTags(raw: string[] | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const t of raw) {
    const n = normalizeTag(String(t));
    if (n) seen.add(n);
  }
  return [...seen];
}

/** Suggested vocabulary, grouped for the UI's filter hints. Not enforced. */
export const BANK_TAG_VOCABULARY = {
  intensity: ["recovery", "endurance", "tempo", "threshold", "vo2max", "anaerobic", "sprint"],
  shape: ["intervals", "long", "steady", "pyramid", "fartlek", "negative-split", "brick"],
  focus: ["technique", "drills", "cadence", "climbing", "pacing", "strength-endurance", "test", "race-simulation"],
  context: ["indoor", "trainer", "treadmill", "track", "hills", "open-water", "pool", "gym"],
  strength: ["hypertrophy", "max-strength", "power", "core", "mobility", "plyometrics"],
} as const;

/** Flat list — what the AI prompts hand over as "prefer these". */
export const SUGGESTED_TAGS: string[] = Object.values(BANK_TAG_VOCABULARY).flat();
