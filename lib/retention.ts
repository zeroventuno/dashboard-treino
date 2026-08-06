// ────────────────────────────────────────────────────────────────────────────
//  Retention signal — who the agency should call today.
//
//  The naive version of this screen counts "inactive: no check-in in N days",
//  and it's close to useless: it surfaces the athletes who were always sporadic
//  and stays silent about the one who trained five times a week until a
//  fortnight ago. That athlete is still paying, hasn't cancelled yet, and is the
//  only one there's still time to save.
//
//  So the signal is the DROP, not the snapshot: sessions completed in the last
//  14 days against the 14 before. A snapshot is the fallback for athletes with
//  no history to compare against.
// ────────────────────────────────────────────────────────────────────────────

export type AthleteState = "new" | "active" | "at_risk" | "inactive";

export interface AttentionRow {
  tenant_id: string;
  name: string;
  email: string;
  created_at: string;
  last_checkin: string | null;
  last_done: string | null;
  done_recent: number;
  done_prev: number;
  checkins_recent: number;
  /** What the owner says this athlete is worth per month; null when unpriced. */
  monthly_value: string | null;
  staff: string[];
  staff_ids: string[];
}

export interface Assessed extends AttentionRow {
  state: AthleteState;
  /** Sessions per week before → now, for the "5x → 1x" reading. */
  weeklyBefore: number;
  weeklyNow: number;
  /** Days since the last sign of life (check-in or completed session). */
  daysSilent: number | null;
  /** Higher = call sooner. Only meaningful for at_risk / inactive. */
  score: number;
}

const DAY = 86_400_000;

function daysSince(iso: string | null, todayISO: string): number | null {
  if (!iso) return null;
  const d = Math.floor((Date.parse(`${todayISO}T00:00:00Z`) - Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)) / DAY);
  return Number.isFinite(d) ? d : null;
}

/**
 * Classify one athlete. `todayISO` is passed in rather than read from the clock
 * so the result is deterministic (and testable).
 *
 * - new: joined in the last 30 days — too early to judge, and they need a
 *   different conversation (onboarding, not rescue).
 * - at_risk: was training and halved. This is the actionable one.
 * - inactive: no sign of life in three weeks.
 * - active: everything else.
 */
export function assess(row: AttentionRow, todayISO: string): Assessed {
  const sinceCheckin = daysSince(row.last_checkin, todayISO);
  const sinceDone = daysSince(row.last_done, todayISO);
  const daysSilent =
    sinceCheckin == null ? sinceDone : sinceDone == null ? sinceCheckin : Math.min(sinceCheckin, sinceDone);

  const weeklyBefore = row.done_prev / 2;
  const weeklyNow = row.done_recent / 2;
  const drop = row.done_prev - row.done_recent;

  const ageDays = daysSince(row.created_at, todayISO) ?? 0;

  let state: AthleteState;
  if (ageDays <= 30) {
    state = "new";
  } else if (daysSilent == null || daysSilent >= 21) {
    // No signal at all, or three weeks of silence.
    state = "inactive";
  } else if (row.done_prev >= 3 && drop >= row.done_prev / 2) {
    // Was consistent (3+ sessions a fortnight) and lost at least half of it.
    state = "at_risk";
  } else if (row.done_recent === 0 && row.checkins_recent === 0) {
    // Nothing done and not even checking in, but still inside three weeks.
    state = "at_risk";
  } else {
    state = "active";
  }

  // Rank by what can still be saved, not by who is furthest gone. An athlete
  // three weeks silent may already be lost; the one who halved their week but
  // checked in yesterday is still reachable — and is the call worth making
  // first. So at_risk always outranks inactive, and within each group the
  // bigger drop (then the longer silence) comes first.
  const base = state === "at_risk" ? 1000 : state === "inactive" ? 0 : -1;
  const score = base < 0 ? 0 : base + Math.max(0, drop) * 10 + Math.min(daysSilent ?? 60, 60);

  return { ...row, state, weeklyBefore, weeklyNow, daysSilent, score };
}

/** The list the owner works through: at-risk and inactive, most urgent first. */
export function needsAttention(rows: AttentionRow[], todayISO: string): Assessed[] {
  return rows
    .map((r) => assess(r, todayISO))
    .filter((a) => a.state === "at_risk" || a.state === "inactive")
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export interface AgencyTotals {
  total: number;
  active: number;
  atRisk: number;
  inactive: number;
  newAthletes: number;
  /** Monthly value of the whole book. */
  revenue: number;
  /** Monthly value sitting on at-risk and inactive athletes — the number that
   * turns "12 people" into a decision. */
  revenueAtRisk: number;
  /** Athletes with no price set, so the figures can be honest about coverage. */
  unpriced: number;
}

export function totals(rows: AttentionRow[], todayISO: string): AgencyTotals {
  const t: AgencyTotals = {
    total: rows.length, active: 0, atRisk: 0, inactive: 0, newAthletes: 0,
    revenue: 0, revenueAtRisk: 0, unpriced: 0,
  };
  for (const r of rows) {
    const { state } = assess(r, todayISO);
    if (state === "active") t.active++;
    else if (state === "at_risk") t.atRisk++;
    else if (state === "inactive") t.inactive++;
    else t.newAthletes++;

    const value = r.monthly_value == null ? null : Number(r.monthly_value);
    if (value == null || !Number.isFinite(value)) t.unpriced++;
    else {
      t.revenue += value;
      if (state === "at_risk" || state === "inactive") t.revenueAtRisk += value;
    }
  }
  return t;
}

/** Per-professional load and how healthy their book is. */
export interface StaffLoad {
  name: string;
  athletes: number;
  atRisk: number;
  active: number;
}

export function byStaff(rows: AttentionRow[], todayISO: string): StaffLoad[] {
  const map = new Map<string, StaffLoad>();
  for (const r of rows) {
    const a = assess(r, todayISO);
    // An athlete with no professional assigned is itself worth seeing.
    const names = r.staff.length ? r.staff : ["—"];
    for (const n of names) {
      const s = map.get(n) ?? { name: n, athletes: 0, atRisk: 0, active: 0 };
      s.athletes++;
      if (a.state === "at_risk" || a.state === "inactive") s.atRisk++;
      if (a.state === "active") s.active++;
      map.set(n, s);
    }
  }
  return [...map.values()].sort((x, y) => y.athletes - x.athletes);
}
