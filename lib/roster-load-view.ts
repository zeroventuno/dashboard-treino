// ────────────────────────────────────────────────────────────────────────────
//  From per-athlete verdicts to a ROSTER-shaped answer.
//
//  lib/roster-load.ts answers "what is happening to this athlete". This file
//  answers the other question, the one a coach with forty athletes actually
//  opens the panel with: "how much of my book is digging a hole right now?" —
//  which is a question about the coach's own periodisation, not about any one
//  person. If a third of the roster is overreaching in the same week, the
//  program is the problem.
//
//  Pure, no clock, no I/O — `todayISO` comes in as an argument, exactly as it
//  does in lib/roster-load.ts, so the same roster classifies the same way twice.
//
//  ── THE COUNTING RULE ──────────────────────────────────────────────────────
//
//  The denominator is the ROSTER, never the rows. getRosterLoad omits an athlete
//  with no sessions from its array ENTIRELY, and classifyLoad returns null for
//  an athlete whose curve is too short or too sparse to read. Both of those are
//  "no reading" — a fourth band that is counted and shown, not folded into "ok"
//  and not quietly dropped from the total.
//
//  Counting rows instead of roster ids would make the distribution flatter and
//  greener every time data went missing: the athletes we know least about would
//  vanish from the picture precisely when a coach most needs to notice them.
//  So every tenant id handed in lands in exactly one band, and an id with no
//  usable summary lands in `none`.
// ────────────────────────────────────────────────────────────────────────────

import { classifyLoad, type LoadLevel, type LoadState, type RosterLoadSummary } from "./roster-load";
import type { TKey } from "./i18n";

/** The three levels plus the honest fourth. `none` is a state, not a low value —
 * same house rule as `never` in lib/testing.ts and the unlit readiness light. */
export type LoadBand = LoadLevel | "none";

/** Display/filter order: worst first, absence last. Matches the sort in
 * needsLoadAttention so the bar and the attention list rank the same way. */
export const LOAD_BANDS = ["overreaching", "watch", "ok", "none"] as const;

export function isLoadBand(v: unknown): v is LoadBand {
  return typeof v === "string" && (LOAD_BANDS as readonly string[]).includes(v);
}

/**
 * The colour of each band — ONE definition, read by the roster card and by the
 * distribution bar, so the wash on a card and the segment in the bar are
 * literally the same token.
 *
 * `ok` is TEAL, not green. Green is the readiness light's word on this screen
 * and means "the athlete says they are fine today"; load is a different fact
 * read off a different signal, and teal is already what the athlete's own PMC
 * paints Form/TSB with (see METRICS in components/PmcChart.tsx). `none` carries
 * no chroma at all — absence is not alarm, and it must never be mistaken for
 * the coral.
 */
export const LOAD_TONE: Record<LoadBand, string> = {
  overreaching: "var(--bad)",
  watch: "var(--warn)",
  ok: "var(--teal)",
  none: "var(--text-faint)",
};

/** Band → label key. Every consumer names a band the same way. */
export const LOAD_LABEL: Record<LoadBand, TKey> = {
  overreaching: "coach.load.lvl.over",
  watch: "coach.load.lvl.watch",
  ok: "coach.load.lvl.ok",
  none: "coach.load.lvl.none",
};

export interface RosterLoadView {
  /** The athlete's state, or null when there is no usable reading. */
  stateFor: (tenantId: string) => LoadState | null;
  /** Which band the athlete falls in — `none` covers both "omitted from the
   * query" and "classifyLoad declined to read it". */
  bandFor: (tenantId: string) => LoadBand;
  /** Athletes per band. Sums to `total`. */
  counts: Record<LoadBand, number>;
  /** Size of the roster the bands were counted over. */
  total: number;
  /** overreaching + watch — the athletes in or heading into high fatigue. This
   * is the number the headline asks about: it is a property of the WEEK'S
   * PROGRAMMING, which is why watch (fatigue climbing fast, level still
   * productive) counts alongside overreaching rather than being rounded down. */
  attention: number;
}

/**
 * Classify a whole roster at once.
 *
 * `tenantIds` is the roster being displayed and defines the denominator;
 * `rows` is whatever getRosterLoad (or demoLoad) returned, in any order and
 * possibly missing athletes entirely.
 */
export function viewRosterLoad(
  tenantIds: string[],
  rows: RosterLoadSummary[],
  todayISO: string,
): RosterLoadView {
  const states = new Map<string, LoadState>();
  for (const r of rows) {
    const s = classifyLoad(r, todayISO);
    if (s) states.set(r.tenant_id, s);
  }

  const counts: Record<LoadBand, number> = { overreaching: 0, watch: 0, ok: 0, none: 0 };
  const seen = new Set<string>();
  for (const id of tenantIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    counts[states.get(id)?.level ?? "none"] += 1;
  }

  return {
    stateFor: (id) => states.get(id) ?? null,
    bandFor: (id) => states.get(id)?.level ?? "none",
    counts,
    total: seen.size,
    attention: counts.overreaching + counts.watch,
  };
}
