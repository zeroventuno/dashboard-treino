// ────────────────────────────────────────────────────────────────────────────
//  Weekly availability — what a training week has to fit around.
//
//  The athlete fills this in themselves, once, on their own dashboard. Both
//  products then read it: in B2C their own AI, in B2B the coach (through
//  get_profile). It is the same field either way — a B2B athlete is just a
//  tenant with an agency, so one implementation serves both.
//
//  Hours per weekday rather than a "days off" list, because "Tuesday is off"
//  and "Tuesday I have 40 minutes" are different weeks, and only the second
//  tells a coach they can put the recovery run there.
// ────────────────────────────────────────────────────────────────────────────

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Hours available per weekday. 0 (or missing) = a day off. */
export type WeekHours = Partial<Record<Weekday, number>>;

/** Preferred disciplines per weekday. An EMPTY or missing list means "no
 * preference", never "forbidden" — an athlete who never filled this in must not
 * end up with a week nobody can write for them. */
export type WeekSports = Partial<Record<Weekday, string[]>>;

export interface Availability {
  hours?: WeekHours;
  /** Which days can hold a long session. Plural: a triathlete often has two. */
  long_days?: Weekday[];
  /** Legacy single value, still read so older profiles keep working. */
  long_day?: Weekday | null;
  /** Which sports the athlete would rather do on each day. For an agency this
   * is where group sessions live — the swim squad always meets on Tuesday. */
  sports?: WeekSports;
  preferred_time?: string;
  equipment?: string[];
  /** ISO stamp written when the athlete presses Done in the settings panel.
   * Distinguishes "answered, and the answer is nothing" from "never opened" —
   * without it the setup badge could never clear for someone who measures
   * nothing and trains whenever. */
  configured_at?: string;
  notes?: string;
  [k: string]: unknown;
}

/** The long days, tolerating the older single-value shape. */
export function longDays(a: Availability | null | undefined): Weekday[] {
  if (Array.isArray(a?.long_days)) return a.long_days.filter((d): d is Weekday => WEEKDAYS.includes(d as Weekday));
  return a?.long_day ? [a.long_day] : [];
}

/** Sports the athlete prefers on a day. Empty = no preference, so callers must
 * read it as "anything goes", not as an empty allow-list. */
export function sportsFor(a: Availability | null | undefined, day: Weekday): string[] {
  const s = a?.sports?.[day];
  return Array.isArray(s) ? s : [];
}

/** Total weekly hours the athlete says they have. */
export function weeklyHours(a: Availability | null | undefined): number {
  if (!a?.hours) return 0;
  return WEEKDAYS.reduce((sum, d) => sum + (Number(a.hours?.[d]) || 0), 0);
}

/** Days with no time at all — what a coach must leave empty. */
export function daysOff(a: Availability | null | undefined): Weekday[] {
  return WEEKDAYS.filter((d) => !(Number(a?.hours?.[d]) > 0));
}

/** The choices the picker offers. Fine-grained where a normal weekday lives,
 * coarser at the top — the difference between 6h and 6h30 on a long ride day
 * doesn't change what anyone prescribes. */
export const HOUR_CHOICES = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 10, 12] as const;

/** Clamp to something a real day can hold, and drop zeros so the stored object
 * stays the short list of days that actually work. */
export function normalizeHours(raw: WeekHours): WeekHours {
  const out: WeekHours = {};
  for (const d of WEEKDAYS) {
    const n = Number(raw[d]);
    if (Number.isFinite(n) && n > 0) out[d] = Math.min(24, Math.round(n * 4) / 4); // quarter-hour steps
  }
  return out;
}

const SPORTS = ["swim", "bike", "run", "strength"];

export function normalizeSports(raw: WeekSports): WeekSports {
  const out: WeekSports = {};
  for (const d of WEEKDAYS) {
    const list = raw[d];
    if (!Array.isArray(list)) continue;
    const clean = [...new Set(list.filter((s) => SPORTS.includes(String(s))))];
    // All four means the same as none — "anything" — but it is kept anyway:
    // dropping it would make four icons the athlete just lit go dark on the
    // next load. Equivalence is the reader's job, not a reason to discard what
    // someone deliberately clicked.
    if (clean.length > 0) out[d] = clean;
  }
  return out;
}
