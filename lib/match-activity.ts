// ────────────────────────────────────────────────────────────────────────────
//  Which planned session is this imported activity?
//
//  Easy when a day holds one session of a sport. The moment it holds two — a
//  short HIIT in the morning and a long endurance ride later — the importer has
//  to choose, and the first version chose by IMPORTANCE: planned before done,
//  then `key_workout`. So a 32-minute activity was claimed by a 1h40 endurance
//  ride marked as the week's key session, which then scored 33% adherence while
//  the HIIT it actually was sat untouched.
//
//  Importance is the wrong axis. The activity should match the session it most
//  RESEMBLES — that is the only question being asked.
// ────────────────────────────────────────────────────────────────────────────

export interface Candidate {
  id: string;
  title: string;
  status: string;
  key_workout?: boolean | null;
  planned_duration_min?: number | null;
  structure?: unknown;
}

export interface ImportedActivity {
  title: string;
  actual_duration_min: number;
}

/** Words too common to mean anything when two titles are compared. */
const NOISE = new Set([
  "bike", "run", "swim", "ride", "corrida", "nado", "natacao", "natação", "pedal",
  "treino", "workout", "session", "de", "do", "da", "the", "a", "o", "e", "and",
  "morning", "afternoon", "evening", "manha", "manhã", "tarde", "noite", "indoor", "outdoor",
]);

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !NOISE.has(w)),
  );
}

/** Shared distinctive words between two titles, 0..1. */
export function titleOverlap(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.min(x.size, y.size);
}

/**
 * Score a candidate against the activity. Higher wins.
 *
 * Duration carries the most weight because it is always present and hard to
 * argue with: a 32-minute recording is not a 100-minute session, whatever
 * either is called. Titles are a strong confirmation when they agree — an
 * athlete who rebuilt the session in MyWhoosh under the same name has told us
 * exactly which one it is — and cost nothing when they don't, since a blank
 * overlap simply adds zero.
 *
 * `key_workout` is deliberately absent. It says which session matters most to
 * the week, which has no bearing on which one was just recorded, and using it
 * is precisely how a long ride swallowed a short one.
 */
export function matchScore(c: Candidate, a: ImportedActivity): number {
  let score = 0;

  // Still expected beats already logged: an untouched planned session is the
  // more likely subject than one someone has already reconciled.
  if (c.status === "planned" || c.status === "skipped") score += 20;

  const planned = Number(c.planned_duration_min ?? 0);
  if (planned > 0 && a.actual_duration_min > 0) {
    // Relative, not absolute: being 10 minutes off a 30-minute session is a
    // different claim from being 10 minutes off a three-hour one.
    const ratio = Math.abs(a.actual_duration_min - planned) / planned;
    score += Math.max(0, 40 * (1 - Math.min(1, ratio)));
  }

  score += 45 * titleOverlap(c.title, a.title);
  return score;
}

/**
 * The session this activity belongs to, or null when nothing on the day fits.
 *
 * With a single candidate this returns it — the point is only to stop guessing
 * wrongly when there are several, not to start refusing the ordinary case.
 */
export function pickMatch(candidates: Candidate[], activity: ImportedActivity): Candidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  let best = candidates[0];
  let bestScore = matchScore(best, activity);
  for (const c of candidates.slice(1)) {
    const s = matchScore(c, activity);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}
