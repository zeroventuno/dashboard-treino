// ────────────────────────────────────────────────────────────────────────────
//  Workout-bank tag vocabulary — mirror of the dashboard's lib/bank-tags.ts.
//  (The MCP server is a separate package with its own build, so this is a
//  deliberate copy; keep the two in sync when the vocabulary changes.)
//
//  `sport` and `phase` are columns already — tags carry the session's FOCUS, so
//  a coach can ask a 500-workout bank for "the threshold bike intervals I can do
//  indoors". Free-form tags are allowed, but everything is normalized so
//  "VO2 Max", "vo2max" and "VO2-Max" don't become three separate filters.
// ────────────────────────────────────────────────────────────────────────────

export const SUGGESTED_TAGS: string[] = [
  // intensity / energy system
  "recovery", "endurance", "tempo", "threshold", "vo2max", "anaerobic", "sprint",
  // session shape
  "intervals", "long", "steady", "pyramid", "fartlek", "negative-split", "brick",
  // focus
  "technique", "drills", "cadence", "climbing", "pacing", "strength-endurance", "test", "race-simulation",
  // context
  "indoor", "trainer", "treadmill", "track", "hills", "open-water", "pool", "gym",
  // strength
  "hypertrophy", "max-strength", "power", "core", "mobility", "plyometrics",
];

/** lowercase, kebab-case, accent-free — one tag, one spelling. */
export function normalizeTag(raw: string): string {
  const kebab = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  // Snap to the vocabulary when only separators differ ("VO2 Max" / "vo2-max" /
  // "vo2max" → one filter). Unknown terms stay kebab-case.
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
