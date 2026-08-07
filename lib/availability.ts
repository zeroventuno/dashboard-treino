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

export interface Availability {
  hours?: WeekHours;
  /** Which day can hold the long session — often not simply the longest slot. */
  long_day?: Weekday | null;
  preferred_time?: string;
  equipment?: string[];
  notes?: string;
  [k: string]: unknown;
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

/** Clamp to something a real day can hold, and drop zeros so the stored object
 * stays the short list of days that actually work. */
export function normalizeHours(raw: WeekHours): WeekHours {
  const out: WeekHours = {};
  for (const d of WEEKDAYS) {
    const n = Number(raw[d]);
    if (Number.isFinite(n) && n > 0) out[d] = Math.min(12, Math.round(n * 4) / 4); // quarter-hour steps
  }
  return out;
}
