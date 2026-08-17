// ────────────────────────────────────────────────────────────────────────────
//  Load state — reading fatigue off the PMC, for a whole roster at once.
//
//  The consolidated view answers "who checked in red" and "whose plan runs out
//  on Thursday". It has never answered "who is digging a hole", because nothing
//  in the coach panel reads training load. That question has a cost the others
//  don't: a coach who misses it does not lose a week of training, they lose the
//  athlete's block — and the evidence was sitting in the database the whole time.
//
//  The curve itself is NOT built here. summarizeCurve() takes the output of
//  lib/pmc-curve.extendCurve — the same function, on the same session TSS, that
//  draws the athlete's own chart — and reduces it to the handful of facts a
//  verdict needs. Nothing in this file re-derives CTL, ATL, TSB or their bands.
//
//  Pure functions only: everything comes in as arguments, including today's
//  date, so the same input always classifies the same way and the whole thing is
//  testable without a database.
//
//  ── THE ONE RULE ───────────────────────────────────────────────────────────
//
//  When the data cannot support a reading, this returns null. Not "ok", not a
//  neutral state — null, so the panel can render nothing at all. A coach who
//  sees no traffic light knows to go and look; a coach who sees a green light
//  computed from three weeks of history has been told something false about a
//  person, and will act on it. Fabricated fatigue is strictly worse than absent
//  fatigue, so every gate below fails towards silence.
// ────────────────────────────────────────────────────────────────────────────

import type { TrainingLoad } from "./types";
import { daysBetween, parseDate, toISO, addDays } from "./utils";
import { CTL_DAYS, TSB_HIGH_FATIGUE, TSB_NEUTRAL_HIGH, TSB_PRODUCTIVE } from "./pmc-curve";

/**
 * One athlete's curve, reduced to what a verdict needs.
 *
 * Note the units in the field names. An earlier draft carried a single
 * `days_logged` that meant "days with a stored training_load row"; once the
 * curve became derived, the same name would have meant "days with a session",
 * and the threshold written against the first meaning would have silently
 * rejected almost every athlete under the second. Two fields, each saying what
 * it counts.
 */
export interface RosterLoadSummary {
  tenant_id: string;
  /** The day the reading describes (YYYY-MM-DD); null when there is no curve. */
  load_date: string | null;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  /** The comparison point, one week earlier. */
  prev_date: string | null;
  prev_tsb: number | null;
  /** CALENDAR days the curve spans — from its first point to load_date. */
  history_days: number;
  /** SESSIONS carrying load in the 42 days ending at load_date. */
  sessions_42d: number;
}

export type LoadLevel = "ok" | "watch" | "overreaching";

export interface LoadState {
  /** Where the athlete is right now. */
  level: LoadLevel;
  /** The TSB the verdict was read from, and the day it describes. */
  tsb: number;
  onISO: string;
  ctl: number | null;
  atl: number | null;
  /**
   * TSB now minus TSB then. NEGATIVE means TSB is falling, i.e. fatigue is
   * accumulating faster than fitness. Null when there is no second reading
   * close enough in time to compare against — the level still stands, only the
   * trend is unknown.
   */
  tsbDelta: number | null;
  /** Days between the two readings compared. Null whenever tsbDelta is. */
  windowDays: number | null;
  /** Fatigue accumulating fast enough to be a change rather than noise. A plain
   * statement about the delta — the escalation it causes is in `level`. */
  rising: boolean;
}

// ── Thresholds ──────────────────────────────────────────────────────────────
//
//  The BANDS are not defined here. TSB_HIGH_FATIGUE and TSB_PRODUCTIVE come
//  from lib/pmc-curve, which is also where lib/pmc.ts gets the chart's zone
//  boundaries — so "very fatigued" on the athlete's chart and "overreaching" on
//  the coach's roster are the same predicate on the same number, and the
//  comparison is `<` in both places so the edges agree too.
//
//  Those bands are the ones in general use around the Performance Management
//  Chart (TrainingPeaks / Joe Friel), and the ones this product already shows
//  athletes: below about -25 is high fatigue and the widely used functional
//  overreaching marker; -25 to -10 is productive training load, where a build
//  block is supposed to sit; above +10 is race-ready/fresh.
//
//  Nothing beyond that is claimed. TSB in the high-fatigue band is a flag to
//  LOOK at an athlete, not a diagnosis: real overtraining is judged from HRV,
//  resting HR, sleep, mood and performance — most of which this product already
//  collects per athlete, and none of which belong in a roster-level number.

/**
 * How far TSB must FALL across the week to count as rising fatigue.
 *
 * OURS, not a published number — the bands above are standard, this is an
 * operational choice and should be read as one. The reasoning: on an unchanged
 * routine TSB wanders a few points day to day (one session moves ATL by roughly
 * tss/7), so a small negative delta is noise. Ten points across a week is
 * larger than that wander and means acute load genuinely outran chronic load,
 * which is the thing worth a coach's attention a week BEFORE it shows up as a
 * TSB in the high-fatigue band. Tune it here, in one place.
 */
export const RISING_DROP = 10;

// ── Data-sufficiency gates: every one of these returns null ─────────────────

/**
 * How far back the curve must reach before its TSB means anything.
 *
 * Ours, and the number that changed most when the curve became derived. CTL is
 * an exponentially weighted average with a 42-day time constant and the curve
 * is seeded at ZERO on the athlete's first session, so a curve only three weeks
 * long is still climbing out of that seed — and TSB = CTL - ATL then reports the
 * seed artefact as fatigue. An athlete who started logging last month can read
 * deep in the high-fatigue band having done one honest week. One full time
 * constant of history is the line taken here.
 *
 * This is CALENDAR days spanned, not sessions logged. The distinction matters:
 * an athlete training four times a week has ~24 sessions in 42 days, so a
 * threshold of 42 applied to a session COUNT would reject essentially everyone.
 */
export const MIN_HISTORY_DAYS = CTL_DAYS;

/**
 * Sessions carrying load in the last 42 days, below which we say nothing.
 *
 * Also ours. Eight is about 1.3 sessions a week — well under any real training
 * routine, so it rejects only near-dormancy. Someone who has essentially
 * stopped has a curve that decays towards zero, and neither "ok" nor
 * "overreaching" is a useful thing to say about them; "they stopped training"
 * is a retention signal and lib/retention already owns it.
 */
export const MIN_SESSIONS_42D = 8;

/**
 * How old the reading may be and still describe today.
 *
 * Its job CHANGED when the curve became derived, and the old reasoning no
 * longer applies: extendCurve walks to today on every call, so an athlete who
 * stopped syncing no longer freezes — their ATL decays and they drift towards
 * fresh, which is both true and harmless. This is now purely a guard against a
 * curve that ended early (a caller passing a stale `todayISO`, an empty tail).
 * Kept because a verdict silently dated last month is exactly the failure this
 * module exists to prevent, and one ATL time constant is the point past which a
 * TSB has largely decayed anyway.
 */
export const MAX_STALE_DAYS = 7;

/**
 * Widest gap between the two compared readings that may still be called a week.
 *
 * The curve has a point per day, so the comparison is normally exactly 7 days
 * and this never binds. It binds when the curve is shorter than a week, or when
 * a caller hands in a sparse series: comparing today against a month ago and
 * reporting it as a weekly trend is the kind of quiet fabrication this module
 * exists to avoid, so past this the trend is dropped and the level reported
 * alone.
 */
export const MAX_COMPARE_DAYS = 14;

/** How far back the comparison reading is taken. */
const COMPARE_DAYS = 7;

/** Tolerates the numeric-as-string that pg can hand back if the type parser is
 * ever removed, and rejects NaN/Infinity outright. */
function num(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Reduce one athlete's PMC to the facts a verdict needs.
 *
 * `curve` is whatever lib/pmc-curve.extendCurve produced for this athlete, and
 * `sessions` are the dated sessions it was built from (used only to count how
 * many carried load — the curve has a point on rest days too, so counting curve
 * points would count rest as training).
 */
export function summarizeCurve(
  tenantId: string,
  curve: TrainingLoad[],
  sessionDatesWithLoad: string[],
  todayISO: string,
): RosterLoadSummary {
  const empty: RosterLoadSummary = {
    tenant_id: tenantId,
    load_date: null, ctl: null, atl: null, tsb: null,
    prev_date: null, prev_tsb: null,
    history_days: 0, sessions_42d: 0,
  };
  if (curve.length === 0) return empty;

  const sorted = [...curve].sort((a, b) => (a.date < b.date ? -1 : 1));
  // Never read past today, even if the caller handed in a projected tail.
  const upToToday = sorted.filter((p) => p.date <= todayISO);
  const last = upToToday[upToToday.length - 1];
  if (!last) return empty;

  const tsb = last.tsb ?? (last.ctl != null && last.atl != null ? last.ctl - last.atl : null);
  if (tsb == null) return empty;

  const prevISO = toISO(addDays(parseDate(last.date), -COMPARE_DAYS));
  // The newest point at or before the target day: exact when the curve is
  // daily (it is), forgiving when a caller hands in something sparser.
  const prev = [...upToToday].reverse().find((p) => p.date <= prevISO) ?? null;
  const prevTsb = prev
    ? prev.tsb ?? (prev.ctl != null && prev.atl != null ? prev.ctl - prev.atl : null)
    : null;

  const windowStart = toISO(addDays(parseDate(last.date), -CTL_DAYS));
  const sessions42d = sessionDatesWithLoad.filter((d) => d > windowStart && d <= last.date).length;

  return {
    tenant_id: tenantId,
    load_date: last.date,
    ctl: last.ctl,
    atl: last.atl,
    tsb: round1(tsb),
    prev_date: prev?.date ?? null,
    prev_tsb: prevTsb == null ? null : round1(prevTsb),
    history_days: daysBetween(upToToday[0].date, last.date),
    sessions_42d: sessions42d,
  };
}

/**
 * One athlete's load state, or null when the data cannot support one.
 *
 * `todayISO` is passed in rather than read from the clock so the result is
 * deterministic — same reason lib/retention.assess takes it.
 *
 * Returns null when:
 *   · there is no curve at all;
 *   · the reading is more than MAX_STALE_DAYS old;
 *   · the curve spans fewer than MIN_HISTORY_DAYS calendar days;
 *   · fewer than MIN_SESSIONS_42D sessions carried load in the last 42 days.
 *
 * A MISSING TREND is not one of these. An athlete with a solid current reading
 * and no usable comparison point gets a level with `tsbDelta: null` — the level
 * is known, only the direction isn't, and hiding both would throw away half of
 * what we actually know.
 */
export function classifyLoad(row: RosterLoadSummary, todayISO: string): LoadState | null {
  const tsb = num(row.tsb);
  if (tsb == null || !row.load_date) return null;

  const age = daysBetween(row.load_date, todayISO);
  // A reading dated in the future is a bug or a projection, not a measurement;
  // a negative age is refused rather than treated as very fresh.
  if (!Number.isFinite(age) || age < 0 || age > MAX_STALE_DAYS) return null;

  if ((row.history_days ?? 0) < MIN_HISTORY_DAYS) return null;
  if ((row.sessions_42d ?? 0) < MIN_SESSIONS_42D) return null;

  // ── Trend, if there is an honest one to be had ────────────────────────────
  const prevTsb = num(row.prev_tsb);
  const gap = row.prev_date ? daysBetween(row.prev_date, row.load_date) : null;
  const comparable =
    prevTsb != null && gap != null && Number.isFinite(gap) && gap > 0 && gap <= MAX_COMPARE_DAYS;

  const tsbDelta = comparable && prevTsb != null ? round1(tsb - prevTsb) : null;
  const windowDays = tsbDelta == null ? null : gap;
  const rising = tsbDelta != null && tsbDelta <= -RISING_DROP;

  // ── The verdict ──────────────────────────────────────────────────────────
  //
  //  `<` not `<=`, matching lib/pmc.ts zoneFor: the bands are half-open, so a
  //  TSB of exactly -25 is "productive load" on the athlete's chart and must not
  //  be "overreaching" on the coach's.
  //
  //  `rising` only escalates an athlete who is ALREADY carrying load. A fresh
  //  athlete whose TSB fell twenty points is coming off a taper and going back
  //  to work — the most normal thing in a training year — and flagging that
  //  would teach the coach to ignore the column within a week.
  const level: LoadLevel =
    tsb < TSB_HIGH_FATIGUE ? "overreaching"
    : tsb < TSB_PRODUCTIVE && rising ? "watch"
    : "ok";

  return {
    level,
    tsb: round1(tsb),
    onISO: row.load_date,
    ctl: num(row.ctl),
    atl: num(row.atl),
    tsbDelta,
    windowDays,
    rising,
  };
}

/** Is this athlete fresh/tapered? Not a level of its own — a coach reading the
 * roster in race week wants to tell "rested on purpose" from "nothing logged",
 * and both otherwise render as `ok`. The boundary is the chart's own race-ready
 * line, so the roster and the athlete's tooltip agree about who is fresh. */
export function isFresh(state: LoadState): boolean {
  return state.tsb > TSB_NEUTRAL_HIGH;
}

/** The athletes worth looking at, worst first: overreaching before watch, and
 * within each the deepest TSB first. Athletes with no usable reading are left
 * out entirely rather than sorted to the bottom — see the rule at the top. */
export function needsLoadAttention(
  rows: RosterLoadSummary[],
  todayISO: string,
): { tenant_id: string; state: LoadState }[] {
  const rank: Record<LoadLevel, number> = { overreaching: 0, watch: 1, ok: 2 };
  return rows
    .map((r) => ({ tenant_id: r.tenant_id, state: classifyLoad(r, todayISO) }))
    .filter((x): x is { tenant_id: string; state: LoadState } => x.state != null)
    .filter((x) => x.state.level !== "ok")
    .sort((a, b) => rank[a.state.level] - rank[b.state.level] || a.state.tsb - b.state.tsb);
}
