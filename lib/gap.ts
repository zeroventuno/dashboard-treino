// ────────────────────────────────────────────────────────────────────────────
//  GAP — grade adjusted pace.
//
//  Pace is what a runner can act on: it's the number on the watch, mid-rep,
//  with a hill coming. So workouts are prescribed in pace. But pace is a liar
//  when the ground moves — the same effort reads 6:10/km up a climb and 4:40/km
//  down the other side — and scoring a session against a flat pace target
//  punishes an athlete for the terrain they were sent to run on.
//
//  GAP is the pace that same effort would have produced on the flat. On flat
//  ground it IS pace, which is what makes it safe to use everywhere rather than
//  as a special case for hilly runs.
//
//  The adjustment uses Minetti's measured cost of running on gradient (J. Appl.
//  Physiol. 2002): a fifth-order polynomial fitted to the metabolic cost per
//  metre across slopes from -45% to +45%. It is the same published model the
//  major platforms build their own grade adjustment on.
// ────────────────────────────────────────────────────────────────────────────

/** Metabolic cost of running, J/kg/m, at gradient `i` expressed as a ratio
 * (0.08 = 8% uphill). Minetti et al. 2002. */
function costOfRunning(i: number): number {
  return 155.4 * i ** 5 - 30.4 * i ** 4 - 43.3 * i ** 3 + 46.3 * i ** 2 + 19.5 * i + 3.6;
}

/** Cost on the flat — the reference every other gradient is expressed against. */
const FLAT_COST = 3.6;

/** The polynomial was fitted between -45% and +45% and diverges outside it: at
 * -60% it turns back upwards and would credit a descent as harder than a climb.
 * Beyond the fitted range the endpoint value is held instead. */
const MAX_GRADE = 0.45;

/**
 * How much harder this gradient is than flat ground. 1 on the flat, ~1.66 at
 * 10% up, ~0.6 at 10% down.
 *
 * Also the floor: Minetti's cost bottoms out around -20%, because past that a
 * descent stops being free and starts costing braking. The polynomial captures
 * that on its own — the curve turns back up — which is why the model is used
 * whole rather than as a simple linear penalty.
 */
export function gradeFactor(gradeRatio: number): number {
  const i = Math.max(-MAX_GRADE, Math.min(MAX_GRADE, gradeRatio));
  return costOfRunning(i) / FLAT_COST;
}

/**
 * Equivalent flat speed for a speed run at a gradient. Uphill returns MORE than
 * the measured speed (the effort was worth a faster flat run), downhill less.
 *
 * Speed rather than pace on purpose: pace inverts — faster is a smaller number
 * — and every zone comparison downstream wants a value that grows with effort.
 * Converting once, here, keeps that inversion out of the rest of the codebase.
 */
export function adjustedSpeed(speedMS: number, gradeRatio: number): number {
  if (!(speedMS > 0)) return 0;
  return speedMS * gradeFactor(gradeRatio);
}

/** Pace in seconds per km → speed in m/s. */
export const paceToSpeed = (secondsPerKm: number): number =>
  secondsPerKm > 0 ? 1000 / secondsPerKm : 0;

/** Speed in m/s → pace in seconds per km. */
export const speedToPace = (speedMS: number): number => (speedMS > 0 ? 1000 / speedMS : 0);

/** "4:45" or "4:45/km" → 285 seconds. Returns null for anything unparseable,
 * so a malformed zone table degrades to "no pace zones" rather than to wrong
 * ones. */
export function parsePace(text: string): number | null {
  const m = /(\d{1,2}):([0-5]\d)/.exec(text.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 285 → "4:45". */
export function formatPace(secondsPerKm: number): string {
  if (!(secondsPerKm > 0) || !Number.isFinite(secondsPerKm)) return "—";
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export interface GapSample {
  /** Seconds since the activity started. */
  t: number;
  /** Instantaneous speed, m/s. */
  speed: number | null;
  /** Gradient as a RATIO, not a percentage. Strava's `grade_smooth` stream is
   * in percent and must be divided by 100 before it gets here. */
  grade: number | null;
  moving?: boolean;
}

/**
 * Average GAP over a run, in seconds per km.
 *
 * Averaged over DISTANCE, not over time: a time average lets the slow uphill
 * seconds outnumber the fast downhill ones and drags the result slower than the
 * run actually was. Pace is a per-distance quantity, so distance is the honest
 * weight.
 */
export function averageGap(samples: GapSample[]): number | null {
  let metres = 0;
  let seconds = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.speed == null || s.speed <= 0 || s.moving === false) continue;
    const next = samples[i + 1];
    const dt = next ? next.t - s.t : 1;
    if (dt <= 0 || dt > 30) continue;

    const equivalent = adjustedSpeed(s.speed, s.grade ?? 0);
    metres += equivalent * dt;
    seconds += dt;
  }

  if (metres <= 0) return null;
  return (seconds / metres) * 1000;
}
