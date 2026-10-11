// ────────────────────────────────────────────────────────────────────────────
//  A TRAKR session → a COROS scheduled workout (createScheduledWorkout).
//
//  Pure: no network, no database — so the same function draws the preview the
//  athlete approves and builds the request that is sent. What they see is what
//  lands on the watch.
//
//  The rules come from the schema COROS serves for the tool (read live, not
//  guessed):
//    • sportType 1 = running, 2 = cycling (5 = trail running — TRAKR has none);
//    • date yyyyMMdd, from today through today + 90 days;
//    • sections: sectionType 1 warmup / 2 training / 3 recovery / 4 cooldown,
//      targetType 2 = time in seconds (1 = distance in metres), positive integers;
//    • intensity, when present, is intensityType (1 HR, 2 pace, 4 power) plus
//      EXACTLY ONE format; absolute ranges: HR 30–240 bpm, pace 120–1499 s/km,
//      power 10–2000 W; running allows 1/2/4, cycling 1/4;
//    • courseName ≤ 100 chars and courseDescription are shown to the athlete
//      exactly as written.
//
//  Conservative on intensity by design. Only a NUMBER the coach wrote ("5:30–
//  5:45/km", "140–150 bpm", "180–200W") becomes a target on the watch. A zone
//  name ("Z2") or a feeling ("forte") stays as text in the description: the
//  athlete's COROS zones are not TRAKR's zones, and a wrong target buzzing on
//  the wrist is worse than none. Nothing is approximated.
// ────────────────────────────────────────────────────────────────────────────

import type { Workout, WorkoutBlock } from "./types";

export const COROS_WINDOW_DAYS = 90;

export interface CorosSection {
  sectionType: 1 | 2 | 3 | 4;
  targetType: 1 | 2;
  targetValue: number;
  intensityType?: 1 | 2 | 4;
  intensityValueStart?: number;
  intensityValueEnd?: number;
}

export interface CorosCourse {
  courseName: string;
  courseDescription: string;
  sportType: 1 | 2;
  sections: CorosSection[];
}

export type MapRefusal = "unsupported_sport" | "not_planned" | "past" | "too_far" | "no_duration";

export type CourseMapping =
  | {
      ok: true;
      /** yyyyMMdd */
      date: string;
      course: CorosCourse;
      /** Sections whose prescription stayed as text (no number to send). */
      textOnly: number;
      /** Stable fingerprint of what would be sent — "changed since sent?". */
      hash: string;
    }
  | { ok: false; reason: MapRefusal };

const DAY = 86_400_000;
const dayMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** Which kind of section a block is, from the words the coach used. */
export function sectionTypeOf(label: string): 1 | 2 | 3 | 4 {
  const t = label.toLowerCase();
  if (/aquec|warm|riscald|calent|échauff|echauff/.test(t)) return 1;
  if (/volta à calma|volta a calma|desaquec|cool|defatic|enfri|retour au calme/.test(t)) return 4;
  if (/recup|recov|descans|rest|repos|pausa|trote|soft/.test(t)) return 3;
  return 2;
}

const clampOk = (a: number, b: number, lo: number, hi: number) => a >= lo && a <= hi && b >= lo && b <= hi;

/** "5:30–5:45/km", "5:30/km" → seconds per km. Only explicit /km paces. */
export function paceRange(text: string): [number, number] | null {
  const m = /(\d{1,2}):(\d{2})\s*(?:(?:-|–|—|a|to|até)\s*(\d{1,2}):(\d{2}))?\s*(?:min)?\s*\/\s*km/i.exec(text);
  if (!m) return null;
  const a = +m[1] * 60 + +m[2];
  const b = m[3] !== undefined ? +m[3] * 60 + +m[4] : a;
  return clampOk(a, b, 120, 1499) ? [Math.min(a, b), Math.max(a, b)] : null;
}

/** "140–150 bpm", "145bpm" → bpm. */
export function hrRange(text: string): [number, number] | null {
  const m = /(\d{2,3})\s*(?:(?:-|–|—|a|to|até)\s*(\d{2,3}))?\s*bpm/i.exec(text);
  if (!m) return null;
  const a = +m[1];
  const b = m[2] !== undefined ? +m[2] : a;
  return clampOk(a, b, 30, 240) ? [Math.min(a, b), Math.max(a, b)] : null;
}

/** "180–200W", "250 W" → watts. Not "+20W a cada minuto" (a change, not a target). */
export function powerRange(text: string): [number, number] | null {
  if (/\+\s*\d+\s*w/i.test(text)) return null;
  const m = /(\d{2,4})\s*(?:(?:-|–|—|a|to|até)\s*(\d{2,4}))?\s*w(?:atts?)?(?![a-z])/i.exec(text);
  if (!m) return null;
  const a = +m[1];
  const b = m[2] !== undefined ? +m[2] : a;
  return clampOk(a, b, 10, 2000) ? [Math.min(a, b), Math.max(a, b)] : null;
}

/** The intensity a piece of coach text pins down, for this sport — or nothing. */
export function intensityOf(
  text: string | null | undefined,
  sport: 1 | 2,
): Pick<CorosSection, "intensityType" | "intensityValueStart" | "intensityValueEnd"> {
  if (!text) return {};
  const set = (t: 1 | 2 | 4, r: [number, number]) => ({ intensityType: t, intensityValueStart: r[0], intensityValueEnd: r[1] });
  const p = powerRange(text);
  if (p) return set(4, p);
  if (sport === 1) {
    const pace = paceRange(text);
    if (pace) return set(2, pace);
  }
  const hr = hrRange(text);
  if (hr) return set(1, hr);
  return {};
}

const fmtMin = (min: number) => (Number.isInteger(min) ? `${min}` : min.toFixed(1));

/** Short, stable hash (FNV-1a) — same in the browser and on the server. */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * `blocks` are the session's resolved blocks (lib/workout-structure's
 * getWorkoutBlocks — the same list the athlete sees in the modal).
 */
export function workoutToCourse(
  w: Pick<Workout, "date" | "discipline" | "status" | "title" | "description" | "planned_duration_min" | "planned_distance_km" | "planned_pace" | "planned_power_watts">,
  blocks: WorkoutBlock[],
  todayISO: string,
): CourseMapping {
  const sport = w.discipline === "run" ? 1 : w.discipline === "bike" ? 2 : null;
  if (!sport) return { ok: false, reason: "unsupported_sport" };
  if (w.status !== "planned") return { ok: false, reason: "not_planned" };

  const days = Math.round((dayMs(w.date) - dayMs(todayISO)) / DAY);
  if (days < 0) return { ok: false, reason: "past" };
  if (days > COROS_WINDOW_DAYS) return { ok: false, reason: "too_far" };

  const sections: CorosSection[] = [];
  let textOnly = 0;
  const lines: string[] = [];

  for (const b of blocks) {
    const secs = Math.round((b.duration_min ?? 0) * 60);
    if (!(secs > 0)) continue;
    const intensity = intensityOf(b.target ?? null, sport);
    if (!intensity.intensityType) textOnly++;
    sections.push({ sectionType: sectionTypeOf(b.label ?? ""), targetType: 2, targetValue: secs, ...intensity });
    lines.push(
      `• ${b.label} — ${fmtMin(b.duration_min)} min` + (b.target ? ` — ${b.target}` : "") + (b.note ? ` (${b.note})` : ""),
    );
  }

  if (sections.length === 0) {
    // No blocks: one section for the whole session, by time, else distance.
    const target = sport === 1 ? w.planned_pace : w.planned_power_watts;
    const intensity = intensityOf(target ?? null, sport);
    if (w.planned_duration_min && w.planned_duration_min > 0) {
      sections.push({ sectionType: 2, targetType: 2, targetValue: Math.round(w.planned_duration_min * 60), ...intensity });
    } else if (w.planned_distance_km && w.planned_distance_km > 0) {
      sections.push({ sectionType: 2, targetType: 1, targetValue: Math.round(w.planned_distance_km * 1000), ...intensity });
    } else {
      return { ok: false, reason: "no_duration" };
    }
    if (!intensity.intensityType) textOnly++;
    if (target) lines.push(`• ${target}`);
  }

  const description = [w.description?.trim(), lines.join("\n")].filter(Boolean).join("\n\n") || w.title;
  const course: CorosCourse = {
    courseName: (w.title.trim() || (sport === 1 ? "Corrida" : "Bike")).slice(0, 100),
    courseDescription: description.slice(0, 2000),
    sportType: sport,
    sections,
  };
  const date = w.date.slice(0, 10).replace(/-/g, "");
  return { ok: true, date, course, textOnly, hash: fingerprint(JSON.stringify({ date, course })) };
}

/** The idInPlan in a create/update result — JSON or prose — or null. */
export function findIdInPlan(payload: unknown, depth = 0): string | null {
  if (typeof payload === "string") {
    const m = /idInPlan["'\s]*[:=]\s*["']?(\d{3,})/i.exec(payload);
    return m ? m[1] : null;
  }
  if (depth > 4 || payload === null || typeof payload !== "object") return null;
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (k.toLowerCase() === "idinplan" && (typeof v === "string" || typeof v === "number")) return String(v);
    const inner = findIdInPlan(v, depth + 1);
    if (inner) return inner;
  }
  return null;
}

/** Whether a queryScheduledWorkoutDetails result says it can't be edited. */
export function saysNotEditable(payload: unknown): boolean {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload ?? "");
  return /editable["'\s]*[:=]\s*["']?false/i.test(text);
}
