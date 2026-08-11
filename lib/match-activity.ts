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
 * How much this candidate LOOKS like the activity, 0..85. Evidence only.
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
export function resemblance(c: Candidate, a: ImportedActivity): number {
  let score = 0;

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
 * Ranking score: resemblance plus a nudge for sessions nobody has touched yet.
 *
 * The status bonus breaks ties BETWEEN plausible candidates — it is not
 * evidence, which is why it lives here and not in `resemblance`, and why the
 * threshold below is applied to resemblance alone. Being still on the calendar
 * cannot make an implausible match plausible.
 */
export function matchScore(c: Candidate, a: ImportedActivity): number {
  const bonus = c.status === "planned" || c.status === "skipped" ? 20 : 0;
  return resemblance(c, a) + bonus;
}

/**
 * Below this much resemblance the activity is not any of the day's sessions.
 *
 * Roughly 30% of the available evidence. A commute — 25 minutes on a day whose
 * planned ride is two hours, sharing no distinctive word — scores about 8 and
 * is refused. A session recorded under a useless name ("Morning Ride") but the
 * right length scores about 39 and is accepted, because duration alone is real
 * evidence.
 */
export const MIN_RESEMBLANCE = 25;

/**
 * The session this activity belongs to, or null when nothing on the day fits.
 *
 * Returning null is the whole point of this function existing, and it used to
 * be impossible: a single candidate was returned unscored, so a ride to work,
 * a walk or a hike was pinned onto whatever was planned for that sport that
 * day, wrecking its adherence. The caller already knows what to do with a null
 * — it inserts the activity as an `extra`, which is exactly where a commute
 * belongs.
 */
export function pickMatch(candidates: Candidate[], activity: ImportedActivity): Candidate | null {
  let best: Candidate | null = null;
  let bestScore = -1;
  for (const c of candidates) {
    const s = matchScore(c, activity);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  if (!best) return null;
  return resemblance(best, activity) >= MIN_RESEMBLANCE ? best : null;
}
