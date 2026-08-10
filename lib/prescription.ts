// ────────────────────────────────────────────────────────────────────────────
//  Saying the same workout in the unit the athlete can actually measure.
//
//  A block stores TWO things: `intensity`, a percentage of threshold that
//  carries no unit at all, and `target`, the line the athlete reads. The
//  percentage is the prescription; the target is a rendering of it. That
//  separation is what lets one workout reach a rider with a power meter as
//  "250W", a runner with a GPS watch as "4:45/km", someone with only a strap as
//  "158-168bpm", and someone with nothing as "7/10".
//
//  Two rules decide which unit wins, and the second is the one that is easy to
//  miss:
//
//   1. What the athlete owns. Prescribing watts to someone without a meter is
//      a number they cannot act on.
//   2. What the BLOCK is. Heart rate lags thirty to ninety seconds behind the
//      effort, so a 45-second rep prescribed in bpm is meaningless even to
//      someone wearing a strap — by the time the number arrives the rep is
//      over. Short and hard is RPE or power territory, whatever the kit.
// ────────────────────────────────────────────────────────────────────────────

import type { Discipline, PerformanceIndicators, WorkoutBlock } from "./types";
import { formatPace, paceToSpeed, speedToPace } from "./gap";

/** What the athlete can measure. Deliberately a closed list: `equipment` used
 * to be free text, which meant nothing could ever read it. */
export const EQUIPMENT = [
  "bike_power",   // power meter or smart trainer
  "run_power",    // Stryd or a watch that reports running power
  "heart_rate",   // chest strap or wrist HR
  "gps",          // any watch that measures pace outdoors
  "trainer",      // indoor trainer — makes .zwo worth exporting
] as const;

export type Equipment = (typeof EQUIPMENT)[number];

/** The unit a target is expressed in. */
export type Unit = "power" | "pace" | "heart_rate" | "rpe";

/** Below this, heart rate cannot keep up with the effort and stops being a
 * usable target. Three minutes is the conventional cutoff — by then HR has
 * settled and reflects the work being done. */
const HR_MIN_BLOCK_MIN = 3;

/**
 * Which unit this athlete should see for this block.
 *
 * `zonesFor` is passed separately from the equipment because owning a strap is
 * not the same as having heart rate zones set: a unit nobody has calibrated
 * produces a target that looks authoritative and is invented.
 */
export function pickUnit(
  discipline: Discipline,
  durationMin: number,
  owns: Equipment[],
  indicators: PerformanceIndicators | null,
): Unit {
  const has = (e: Equipment) => owns.includes(e);
  const hrUsable = has("heart_rate") && !!indicators?.hr_zones && durationMin >= HR_MIN_BLOCK_MIN;

  if (discipline === "bike") {
    if (has("bike_power") && indicators?.ftp_watts) return "power";
    if (hrUsable) return "heart_rate";
    return "rpe";
  }

  if (discipline === "run") {
    // Pace before running power on purpose. Power is the better signal on
    // paper and almost nobody owns a meter, while every runner with a watch
    // can hold a pace — and GAP fixes the hill problem after the fact.
    if (has("gps") && indicators?.run_pace_zones) return "pace";
    if (has("run_power") && indicators?.ftp_watts) return "power";
    if (hrUsable) return "heart_rate";
    return "rpe";
  }

  if (discipline === "swim") {
    if (indicators?.swim_pace_zones || indicators?.swim_pace_per_100m) return "pace";
    return "rpe";
  }

  return "rpe";
}

/** 0-10, the scale athletes already answer in when asked how hard something
 * was. Mapped from percentage of threshold. */
function rpeFor(pct: number): string {
  const rpe = Math.max(1, Math.min(10, Math.round(pct / 10)));
  return `${rpe}/10`;
}

/** Midpoint of the zone band a percentage lands in, ±spread, as watts. */
function powerTarget(pct: number, ftp: number): string {
  const watts = Math.round((pct / 100) * ftp);
  // A single number reads as a demand nobody can hold; a band is what a coach
  // would actually say out loud.
  const spread = Math.max(3, Math.round(watts * 0.03));
  return `${watts - spread}-${watts + spread}W`;
}

/** Pace band for a percentage of threshold pace.
 *
 * Percentage of THRESHOLD, not of speed: 105% intensity means going harder,
 * which is a faster pace and therefore a smaller number. Inverting here is
 * what keeps the rest of the file thinking in one direction. */
function paceTarget(pct: number, thresholdPace: number): string {
  const speed = paceToSpeed(thresholdPace) * (pct / 100);
  const secs = speedToPace(speed);
  const spread = Math.max(3, Math.round(secs * 0.02));
  return `${formatPace(secs + spread)}-${formatPace(secs - spread)}/km`;
}

/** Heart-rate band, read off the athlete's own zone table rather than computed
 * from a percentage — HR doesn't scale linearly with effort, so a percentage of
 * max is a worse answer than the zones they already have. */
function hrTarget(pct: number, zones: Record<string, [number, number] | string>): string | null {
  const zone = pct <= 55 ? 1 : pct <= 75 ? 2 : pct <= 90 ? 3 : pct <= 105 ? 4 : 5;
  for (const [label, value] of Object.entries(zones)) {
    if (!new RegExp(`z\\s*${zone}`, "i").test(label)) continue;
    if (Array.isArray(value)) return `${value[0]}-${value[1]}bpm`;
    if (typeof value === "string") return `${value}bpm`;
  }
  return null;
}

export interface Prescribed {
  /** The line to show the athlete. */
  target: string;
  unit: Unit;
}

/**
 * Which unit a coach's hand-written target is expressed in.
 *
 * Text, because that's what a coach types. "250W" is a power instruction,
 * "4:45/km" a pace one, "155bpm" a heart-rate one — and the unit they chose is
 * the one the session has to be judged in later, whatever kit the athlete owns.
 */
export function inferUnit(target: string): Unit | null {
  const t = target.toLowerCase();
  if (/\d\s*w\b|watt/.test(t)) return "power";
  if (/bpm|\bfc\b|\bhr\b|batimento/.test(t)) return "heart_rate";
  if (/\/\s*km|\/\s*100\s*m|\bpace\b|min\/km/.test(t)) return "pace";
  if (/\/\s*10\b|rpe|pse|percep/.test(t)) return "rpe";
  return null;
}

/**
 * The metric this block was PRESCRIBED in — the one it must be scored against.
 *
 * This is the fix for a brick run that scored 4 out of 100. The coach asked for
 * 12 minutes at 6:20-6:40/km; the athlete ran 6:49/km on tired legs with their
 * heart rate at 152. Measuring by pace, they did exactly as told. Measuring by
 * heart rate, they were three zones too hard — and an elevated heart rate at an
 * easy pace off the bike is precisely the response a brick is designed to
 * produce. Judged against an instruction nobody gave, obedience looked like
 * failure.
 *
 * Order matters: what the coach actually wrote outranks what we would have
 * chosen for this athlete, because they may have had a reason.
 */
export function metricOf(
  block: WorkoutBlock,
  discipline: Discipline,
  owns: Equipment[],
  indicators: PerformanceIndicators | null,
): Unit {
  if (block.target) {
    const written = inferUnit(block.target);
    if (written) return written;
  }
  return pickUnit(discipline, block.duration_min, owns, indicators);
}

/**
 * The metric the coach actually WROTE this session in, from the target text
 * alone — no equipment, no zone tables, no athlete.
 *
 * Deliberately separate from `sessionMetric`: this is the one callers can use
 * where none of that context is available, which is most of them. Returns null
 * when nothing was written in a recognisable unit, and null means "don't know",
 * never "no unit" — the difference decides whether a comparison is refused or
 * simply allowed.
 */
export function writtenMetric(blocks: WorkoutBlock[] | null | undefined): Unit | null {
  if (!blocks?.length) return null;
  const minutes = new Map<Unit, number>();
  for (const b of blocks) {
    if (!b.target) continue;
    const u = inferUnit(b.target);
    if (u) minutes.set(u, (minutes.get(u) ?? 0) + (b.duration_min || 0));
  }
  let best: Unit | null = null;
  let most = 0;
  for (const [u, m] of minutes) {
    if (m > most) {
      most = m;
      best = u;
    }
  }
  return best;
}

/** The metric a whole session should be judged in: whichever its blocks mostly
 * speak. A session mixing units is judged by the one carrying the most time,
 * since that is where the coach's intent actually lives. */
export function sessionMetric(
  blocks: WorkoutBlock[] | null | undefined,
  discipline: Discipline,
  owns: Equipment[],
  indicators: PerformanceIndicators | null,
): Unit {
  if (!blocks?.length) {
    return pickUnit(discipline, 60, owns, indicators);
  }
  const minutes = new Map<Unit, number>();
  for (const b of blocks) {
    const u = metricOf(b, discipline, owns, indicators);
    minutes.set(u, (minutes.get(u) ?? 0) + (b.duration_min || 0));
  }
  let best: Unit = "rpe";
  let most = -1;
  for (const [u, m] of minutes) {
    if (m > most) {
      most = m;
      best = u;
    }
  }
  return best;
}

/**
 * Render one block for one athlete.
 *
 * A target the coach typed by hand always wins — they may know something the
 * zone table doesn't, and silently overwriting a human instruction is not this
 * function's job. Everything else is derived from the percentage.
 */
export function prescribe(
  block: WorkoutBlock,
  discipline: Discipline,
  owns: Equipment[],
  indicators: PerformanceIndicators | null,
): Prescribed | null {
  if (block.target) return { target: block.target, unit: "rpe" };
  if (block.intensity == null) return null;

  const pct = block.intensity;
  const unit = pickUnit(discipline, block.duration_min, owns, indicators);

  if (unit === "power" && indicators?.ftp_watts) {
    return { target: powerTarget(pct, Number(indicators.ftp_watts)), unit };
  }

  if (unit === "pace") {
    if (discipline === "run" && indicators?.run_threshold_pace) {
      const t = parseThreshold(indicators.run_threshold_pace);
      if (t) return { target: paceTarget(pct, t), unit };
    }
    if (discipline === "swim" && indicators?.swim_pace_per_100m) {
      const t = parseThreshold(indicators.swim_pace_per_100m);
      if (t) {
        const speed = (100 / t) * (pct / 100);
        return { target: `${formatPace(100 / speed)}/100m`, unit };
      }
    }
  }

  if (unit === "heart_rate" && indicators?.hr_zones) {
    const hr = hrTarget(pct, indicators.hr_zones);
    if (hr) return { target: hr, unit };
  }

  // Nothing calibrated for the chosen unit — say it in the one scale that needs
  // no equipment at all rather than showing a blank.
  return { target: rpeFor(pct), unit: "rpe" };
}

function parseThreshold(text: string): number | null {
  const m = /(\d{1,2}):([0-5]\d)/.exec(text);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Read the athlete's equipment out of stored preferences, tolerating the free
 * text that was there before this list existed. */
export function readEquipment(raw: unknown): Equipment[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set<string>(EQUIPMENT);
  return raw.filter((x): x is Equipment => typeof x === "string" && known.has(x));
}
