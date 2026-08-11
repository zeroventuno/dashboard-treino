// ────────────────────────────────────────────────────────────────────────────
//  Multi-week plan blocks: fitting a template week onto a real athlete.
//
//  The workout bank holds single sessions, and prescribing one session at a time
//  does not scale to a hundred athletes however good the batch modal is — the
//  UNIT is wrong. What scales is applying "Base, 4 weeks" to a cohort and having
//  the system place each week on the days that athlete actually has.
//
//  That last part is the whole problem. A template week says "a long ride, two
//  runs, a swim"; it cannot say WHICH DAY, because Tuesday is 45 minutes for one
//  athlete and three hours for another, and the swim squad meets Thursday for
//  one of them and never for the rest. The dashboard already knows all of this —
//  the athlete fills it in themselves under "My week" — and until now nothing
//  read it at prescription time.
//
//  Everything here is pure: a template week plus an availability in, a day
//  assignment out. No database, no dates.
// ────────────────────────────────────────────────────────────────────────────

import type { Discipline, WorkoutBlock } from "./types";
import { WEEKDAYS, longDays, sportsFor, type Availability, type Weekday } from "./availability";

export interface BlockSession {
  discipline: Discipline;
  title: string;
  duration_min: number;
  structure?: WorkoutBlock[] | null;
  key_workout?: boolean;
  /** Needs one of the athlete's long days — the ride or run the week is built
   * around, which only fits where they have a real block of time. */
  long?: boolean;
}

export interface PlanWeek {
  /** Optional note the coach writes for the week ("recovery — hold back"). */
  focus?: string | null;
  sessions: BlockSession[];
}

export interface PlanBlock {
  name: string;
  phase: string | null;
  weeks: PlanWeek[];
}

export interface Placement {
  day: Weekday;
  session: BlockSession;
}

export interface Distribution {
  placed: Placement[];
  /**
   * Sessions that did not fit.
   *
   * Returned, never dropped. A template built for eight hours applied to an
   * athlete with five has to lose something, and the coach is the one who
   * decides what — silently discarding the third run would produce a week that
   * looks deliberate and isn't.
   */
  unplaced: BlockSession[];
}

/** Minutes each weekday can hold. */
function capacity(a: Availability): Record<Weekday, number> {
  const out = {} as Record<Weekday, number>;
  for (const d of WEEKDAYS) out[d] = Math.round((Number(a.hours?.[d]) || 0) * 60);
  return out;
}

/**
 * How well a day suits a session. Higher is better; -1 means it cannot go there.
 *
 * The ordering of these rules is the design:
 *  · capacity is a hard limit, because a 2h session on a 45min day is a week
 *    the athlete abandons, and an abandoned week is worse than a missing one;
 *  · a long session belongs on a long day — that is what the athlete marked
 *    them for;
 *  · a day where they said they'd rather do this sport wins heavily. In an
 *    agency that is usually the day the squad session meets, so ignoring it
 *    doesn't just annoy them, it takes them out of the group;
 *  · among equals, the emptiest day, so a week spreads instead of stacking.
 */
function score(
  session: BlockSession,
  day: Weekday,
  left: Record<Weekday, number>,
  a: Availability,
  longs: Weekday[],
  used: Set<Weekday>,
): number {
  if (left[day] < session.duration_min) return -1;
  if (session.long && !longs.includes(day)) return -1;

  let s = 0;
  if (session.long && longs.includes(day)) s += 100;

  // A blank list means "no preference", never "forbidden" — the athlete far more
  // likely never filled it in than refuses to train.
  const prefs = sportsFor(a, day);
  if (prefs.length > 0 && prefs.includes(session.discipline)) s += 60;

  // An empty day beats a day that already has something. Remaining CAPACITY
  // alone was not enough and produced the opposite of the intent: the biggest
  // day stays the biggest even after taking a session, so three runs all landed
  // on Saturday. Training five days a week is not the same stimulus as cramming
  // the same hours into two, so spreading has to be a rule rather than a
  // tie-break — but it stays below a stated sport preference, since that is
  // usually the day the squad meets.
  if (!used.has(day)) s += 25;

  // Remaining capacity only breaks ties from here.
  s += left[day] / 30;
  return s;
}

/**
 * Place one template week onto the athlete's own week.
 *
 * Hardest first — long sessions, then key workouts, then by duration. A greedy
 * pass that placed the easy ones first would fill the long day with a 40-minute
 * run and leave the three-hour ride homeless.
 */
export function distribute(week: PlanWeek, availability: Availability): Distribution {
  const left = capacity(availability);
  const longs = longDays(availability).filter((d) => left[d] > 0);

  const order = [...week.sessions].sort((x, y) => {
    if (!!y.long !== !!x.long) return y.long ? 1 : -1;
    if (!!y.key_workout !== !!x.key_workout) return y.key_workout ? 1 : -1;
    return y.duration_min - x.duration_min;
  });

  const placed: Placement[] = [];
  const unplaced: BlockSession[] = [];
  const used = new Set<Weekday>();

  for (const session of order) {
    let best: Weekday | null = null;
    let bestScore = -1;
    for (const day of WEEKDAYS) {
      const s = score(session, day, left, availability, longs, used);
      if (s > bestScore) {
        bestScore = s;
        best = day;
      }
    }

    // A long session that found no long day falls back to any day that fits:
    // better on the wrong day than not at all, and the coach sees where it
    // landed. Without this, an athlete who never marked a long day would lose
    // every long ride in the block.
    if (best === null || bestScore < 0) {
      const fallback = session.long
        ? WEEKDAYS.filter((d) => left[d] >= session.duration_min).sort((x, y) => left[y] - left[x])[0]
        : undefined;
      if (fallback) {
        placed.push({ day: fallback, session });
        left[fallback] -= session.duration_min;
        used.add(fallback);
      } else {
        unplaced.push(session);
      }
      continue;
    }

    placed.push({ day: best, session });
    left[best] -= session.duration_min;
    used.add(best);
  }

  // Back into weekday order, so the result reads like a week rather than like
  // the order the algorithm happened to consider things.
  placed.sort((p, q) => WEEKDAYS.indexOf(p.day) - WEEKDAYS.indexOf(q.day));
  return { placed, unplaced };
}

/**
 * Scale a template to the athlete in front of you.
 *
 * Not proportional, and this is the part coaches get wrong when they do it by
 * hand: a beginner needs the warm-up and cool-down just as much as anyone, so
 * shrinking everything by 60% produces a session with a 6-minute warm-up and no
 * training effect. The steady middle and the number of repetitions absorb the
 * difference instead.
 *
 * `intensity` is never touched — it is a percentage of that athlete's OWN
 * threshold, so it is already personal.
 */
export function scaleSession(session: BlockSession, factor: number): BlockSession {
  if (!(factor > 0) || factor === 1 || !session.structure?.length) {
    return { ...session, duration_min: Math.round(session.duration_min * Math.max(0.1, factor)) };
  }

  const blocks = session.structure;
  const isEdge = (i: number) => i === 0 || i === blocks.length - 1;
  const edgeMinutes = blocks.filter((_, i) => isEdge(i)).reduce((n, b) => n + b.duration_min, 0);
  const middleMinutes = blocks.reduce((n, b) => n + b.duration_min, 0) - edgeMinutes;

  const target = session.duration_min * factor;
  // Whatever is left after keeping the warm-up and cool-down intact.
  const middleTarget = Math.max(0, target - edgeMinutes);
  const middleFactor = middleMinutes > 0 ? middleTarget / middleMinutes : 1;

  const scaled = blocks.map((b, i) =>
    isEdge(i) ? b : { ...b, duration_min: Math.round(b.duration_min * middleFactor * 10) / 10 },
  );

  return {
    ...session,
    structure: scaled,
    duration_min: Math.round(scaled.reduce((n, b) => n + b.duration_min, 0)),
  };
}
