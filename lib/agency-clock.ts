// ────────────────────────────────────────────────────────────────────────────
//  What "today" is, for an agency.
//
//  Every coach screen used to open with `toISO(new Date())`, which is the
//  SERVER's calendar day — UTC on Vercel. That date is not decoration: it picks
//  the readiness light, the day's to-do list, the "no check-in in N days"
//  counters and the reconciliation. An owner in Rome at 00:30 was being shown
//  yesterday, so an athlete who checked in an hour earlier read as a day
//  silent. Seven pages each doing the same `new Date()` meant seven places to
//  get it wrong, so the conversion lives here and only here.
//
//  THE PLATFORM ALREADY KNOWS THE ZONES. Intl carries the whole tz database —
//  daylight saving, the year Brazil stopped observing it, Lord Howe's half
//  hour. Hand-rolled offset arithmetic reimplements that badly and goes stale;
//  a date library would be a dependency for something the runtime does.
//
//  PURE ON PURPOSE. `now` is a parameter with a default, never a hidden read of
//  the clock, so the whole thing is testable at a fixed instant — which is the
//  only way to assert that the same moment is two different days in two zones.
// ────────────────────────────────────────────────────────────────────────────

/** What the panel falls back to, and what the column defaults to. Matches the
 * behaviour the pages had before there was a setting, so an agency that never
 * opens the screen sees nothing change. */
export const DEFAULT_TIMEZONE = "UTC";

let known: Set<string> | null = null;

/**
 * The zone names THIS runtime accepts, sorted, ready for a picker.
 *
 * `Intl.supportedValuesOf` returns only CANONICAL IANA names, and "UTC" is not
 * one of them — it is an alias for "Etc/UTC", and the Etc/* zones are left out
 * of the list entirely. Validating strictly against the raw list would have
 * rejected our own default, so it is added back here. Computed once: the list
 * is ~420 strings and never changes within a process.
 */
export function timezoneNames(): string[] {
  return [...zoneSet()].sort();
}

function zoneSet(): Set<string> {
  if (!known) known = new Set([DEFAULT_TIMEZONE, ...Intl.supportedValuesOf("timeZone")]);
  return known;
}

/**
 * Is this a zone name the runtime actually knows?
 *
 * Exact, canonical match — "europe/rome" is refused even though
 * Intl.DateTimeFormat would quietly accept it, because what gets stored should
 * be the one spelling the rest of the system will compare against.
 *
 * The write path calls this and REFUSES an unknown name rather than storing it.
 * A zone nobody can resolve doesn't fail loudly later; it makes every date in
 * the panel silently fall back, and a wrong date reads as a fact.
 */
export function isTimezone(v: unknown): v is string {
  return typeof v === "string" && zoneSet().has(v);
}

/** A stored value → a zone we can format with. Anything unrecognised (null from
 * a database that predates the migration, junk written by hand) degrades to
 * UTC, which is what the panel did before the setting existed. */
export function resolveTimezone(v: string | null | undefined): string {
  return isTimezone(v) ? v : DEFAULT_TIMEZONE;
}

// Gregorian is pinned explicitly: the calendar comes from the locale otherwise,
// and a non-Gregorian one would return a year the rest of the app can't parse.
const ISO_PARTS = { year: "numeric", month: "2-digit", day: "2-digit" } as const;

/**
 * The calendar day `now` falls on **in `zone`**, as "YYYY-MM-DD".
 *
 * This is the one conversion — every coach page's `todayISO` comes from here.
 * Note that it is genuinely a different DAY, not a shifted time: at
 * 2026-08-18T23:30Z it is already the 19th in Rome and still the 18th in São
 * Paulo, and that is exactly the boundary the old code got wrong.
 */
export function todayInZone(zone: string | null | undefined, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
    timeZone: resolveTimezone(zone),
    ...ISO_PARTS,
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
