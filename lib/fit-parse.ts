// ────────────────────────────────────────────────────────────────────────────
//  Reading a .fit activity file.
//
//  Why this exists when the Strava import already works: some of what a coach
//  asks for is simply not on any API. Ground contact time, vertical oscillation,
//  vertical ratio, step length and running power live in the watch's own file
//  and nowhere else — verified on a real Garmin recording, where all six sit in
//  the `record` message once per second. Strava has none of them.
//
//  It also removes the gatekeeper. A file the athlete owns has no athlete cap,
//  no shared rate limit and no clause obliging us to delete it. And the work
//  isn't spent if a Garmin partnership ever happens: their API delivers .fit
//  too, so this is the same code path with a different postman.
//
//  Only four of the FIT profile's hundreds of message types are decoded —
//  file_id, session, lap, record. Everything else is skipped by offset. A parser
//  that understood the whole profile would be ten times the size and no more
//  useful, and every field it guessed at would be a silent wrong number.
//
//  Correctness note: this is binary, so a wrong offset does not throw — it
//  returns something plausible. The field mapping is therefore checked against
//  numbers Garmin itself reports for the same activity (see the test).
// ────────────────────────────────────────────────────────────────────────────

import type { Discipline } from "./types";

/** FIT counts seconds from 1989-12-31 UTC, not from the Unix epoch. */
const FIT_EPOCH_MS = 631_065_600_000;

/** Byte width per base type number (index = base type). */
const BASE_SIZE = [1, 1, 1, 2, 2, 4, 4, 1, 4, 8, 1, 2, 4, 1, 8, 8, 8];

/** The value each base type uses to mean "not recorded". Reading these as real
 * numbers is how a parser ends up reporting a heart rate of 255. */
const INVALID: Record<number, number> = {
  0: 0xff, 1: 0x7f, 2: 0xff, 3: 0x7fff, 4: 0xffff, 5: 0x7fffffff, 6: 0xffffffff,
  10: 0x00, 11: 0x0000, 12: 0x00000000, 13: 0xff,
};

interface FieldDef { num: number; size: number; base: number; dev?: boolean }
interface MessageDef { global: number; big: boolean; fields: FieldDef[]; totalSize: number }

/** Global message numbers we decode. */
const MSG = { FILE_ID: 0, SESSION: 18, LAP: 19, RECORD: 20 } as const;

// ── Field numbers ───────────────────────────────────────────────────────────
// Session and lap use DIFFERENT numbers for the same idea — session.avg_speed is
// 14, lap.avg_speed is 13, and everything after shifts by one. Mixing them up
// yields numbers that look fine and are wrong, which is exactly what the
// against-Garmin test is there to catch.

const F_RECORD = {
  timestamp: 253, heartRate: 3, cadence: 4, distance: 5, speed: 6, power: 7,
  verticalOscillation: 39, stanceTimePercent: 40, stanceTime: 41,
  enhancedSpeed: 73, verticalRatio: 83, stanceTimeBalance: 84, stepLength: 85,
} as const;

const F_SESSION = {
  startTime: 2, sport: 5, totalElapsed: 7, totalTimer: 8, totalDistance: 9,
  totalCalories: 11, avgSpeed: 14, avgHeartRate: 16, maxHeartRate: 17,
  avgCadence: 18, avgPower: 20, maxPower: 21, totalAscent: 22,
  normalizedPower: 34,
} as const;

const F_LAP = {
  messageIndex: 254, startTime: 2, totalElapsed: 7, totalTimer: 8,
  totalDistance: 9, avgSpeed: 13, maxSpeed: 14, avgHeartRate: 15,
  maxHeartRate: 16, avgCadence: 17, avgPower: 19, maxPower: 20, totalAscent: 21,
} as const;

const F_FILE_ID = { type: 0, manufacturer: 1, product: 2, serial: 3, timeCreated: 4 } as const;

/**
 * Scale divisors — FIT stores fixed-point integers. Kept PER MESSAGE, because
 * the same field number means different things in different messages: 5 is
 * `distance` in a record and `sport` in a session. A single shared table
 * divided the sport enum by 100 and produced 0.01, which is not an error, just
 * a wrong answer — precisely the failure mode this file's header warns about.
 */
type Scales = Record<number, number>;

const SCALE_RECORD: Scales = {
  [F_RECORD.distance]: 100,            // cm → m
  [F_RECORD.speed]: 1000,              // mm/s → m/s
  [F_RECORD.enhancedSpeed]: 1000,
  [F_RECORD.verticalOscillation]: 10,  // → mm
  [F_RECORD.stanceTimePercent]: 100,   // → %
  [F_RECORD.stanceTime]: 10,           // → ms
  [F_RECORD.verticalRatio]: 100,       // → %
  [F_RECORD.stanceTimeBalance]: 100,   // → %
  [F_RECORD.stepLength]: 10,           // → mm
};

const SCALE_SESSION: Scales = {
  [F_SESSION.totalElapsed]: 1000,      // ms → s
  [F_SESSION.totalTimer]: 1000,
  [F_SESSION.totalDistance]: 100,      // cm → m
  [F_SESSION.avgSpeed]: 1000,
};

const SCALE_LAP: Scales = {
  [F_LAP.totalElapsed]: 1000,
  [F_LAP.totalTimer]: 1000,
  [F_LAP.totalDistance]: 100,
  [F_LAP.avgSpeed]: 1000,
  [F_LAP.maxSpeed]: 1000,
};

/** FIT's sport enum → the disciplines this product programs. Anything else
 * returns null and the file is refused rather than filed as the wrong sport. */
function toDiscipline(sport: number): Discipline | null {
  if (sport === 1) return "run";
  if (sport === 2) return "bike";
  if (sport === 5) return "swim";
  if (sport === 10) return "strength";
  return null;
}

// ── Decoding ────────────────────────────────────────────────────────────────

function readValue(buf: Buffer, at: number, f: FieldDef, big: boolean, scales: Scales): number | null {
  // Arrays and strings: we want none of the fields that use them, so they're
  // read as "absent" rather than mis-decoded into a number.
  if (f.base === 7 || f.size > BASE_SIZE[f.base]) return null;

  let raw: number;
  switch (f.base) {
    case 0: case 2: case 10: case 13: raw = buf.readUInt8(at); break;
    case 1: raw = buf.readInt8(at); break;
    case 3: raw = big ? buf.readInt16BE(at) : buf.readInt16LE(at); break;
    case 4: case 11: raw = big ? buf.readUInt16BE(at) : buf.readUInt16LE(at); break;
    case 5: raw = big ? buf.readInt32BE(at) : buf.readInt32LE(at); break;
    case 6: case 12: raw = big ? buf.readUInt32BE(at) : buf.readUInt32LE(at); break;
    case 8: raw = big ? buf.readFloatBE(at) : buf.readFloatLE(at); break;
    case 9: raw = big ? buf.readDoubleBE(at) : buf.readDoubleLE(at); break;
    default: return null;
  }

  if (raw === INVALID[f.base] || Number.isNaN(raw)) return null;
  const scale = scales[f.num];
  return scale ? raw / scale : raw;
}

/** One decoded message: field number → value, with anything unreadable absent. */
type Row = Map<number, number>;

function decodeRow(buf: Buffer, at: number, def: MessageDef, wanted: Set<number>, scales: Scales): Row {
  const row: Row = new Map();
  let p = at;
  for (const f of def.fields) {
    if (!f.dev && wanted.has(f.num)) {
      const v = readValue(buf, p, f, def.big, scales);
      if (v !== null) row.set(f.num, v);
    }
    p += f.size;
  }
  return row;
}

// ── The shapes this hands back ──────────────────────────────────────────────

export interface FitSample {
  /** Seconds since the activity started. */
  t: number;
  heartRate: number | null;
  power: number | null;
}

export interface FitLap {
  index: number;
  seconds: number;
  distanceM: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  avgPower: number | null;
  maxPower: number | null;
  avgCadence: number | null;
  avgSpeed: number | null;
  ascentM: number | null;
}

/** The numbers no API hands over. Averaged across the recording rather than
 * read from the session summary: one place the value can come from is one place
 * it can be wrong. */
export interface RunningDynamics {
  verticalOscillationMm: number;
  stanceTimeMs: number;
  verticalRatioPct: number;
  stepLengthMm: number;
  /** Left/right split, 50 = even. Absent on devices that don't measure it. */
  balancePct: number | null;
}

export interface FitActivity {
  /** Deterministic: the same file always yields the same id, so re-uploading
   * updates the session instead of stacking a duplicate. */
  externalId: string;
  startISO: string;
  date: string;
  discipline: Discipline | null;
  sport: number;
  timerSeconds: number;
  distanceM: number | null;
  calories: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  avgPower: number | null;
  maxPower: number | null;
  normalizedPower: number | null;
  avgCadence: number | null;
  avgSpeedMS: number | null;
  ascentM: number | null;
  laps: FitLap[];
  samples: FitSample[];
  dynamics: RunningDynamics | null;
}

const WANT_RECORD = new Set<number>(Object.values(F_RECORD));
const WANT_SESSION = new Set<number>(Object.values(F_SESSION));
const WANT_LAP = new Set<number>(Object.values(F_LAP));
const WANT_FILE_ID = new Set<number>(Object.values(F_FILE_ID));

export class FitParseError extends Error {}

/**
 * Decode a .fit activity. Throws FitParseError on anything that isn't one —
 * an athlete who uploads a photo should be told so, not handed a silent no-op.
 */
export function parseFit(buf: Buffer): FitActivity {
  if (buf.length < 14) throw new FitParseError("file too short to be a .fit");

  const headerSize = buf.readUInt8(0);
  if (headerSize !== 12 && headerSize !== 14) throw new FitParseError("bad .fit header");
  if (buf.toString("ascii", 8, 12) !== ".FIT") throw new FitParseError("not a .fit file");

  const dataSize = buf.readUInt32LE(4);
  const end = Math.min(headerSize + dataSize, buf.length);

  const defs = new Map<number, MessageDef>();
  const records: Row[] = [];
  const laps: Row[] = [];
  let session: Row | null = null;
  let fileId: Row | null = null;

  let p = headerSize;
  while (p < end) {
    const h = buf.readUInt8(p++);

    // Compressed timestamp header: 2-bit local type, and a time offset we don't
    // need because record timing comes from the timestamp field itself.
    if (h & 0x80) {
      const def = defs.get((h >> 5) & 0x3);
      if (!def) throw new FitParseError("data before its definition");
      if (def.global === MSG.RECORD) records.push(decodeRow(buf, p, def, WANT_RECORD, SCALE_RECORD));
      p += def.totalSize;
      continue;
    }

    const local = h & 0x0f;

    if (h & 0x40) {
      p++; // reserved
      const big = buf.readUInt8(p++) === 1;
      const global = big ? buf.readUInt16BE(p) : buf.readUInt16LE(p);
      p += 2;
      const count = buf.readUInt8(p++);

      const fields: FieldDef[] = [];
      let totalSize = 0;
      for (let i = 0; i < count; i++) {
        const num = buf.readUInt8(p++);
        const size = buf.readUInt8(p++);
        const base = buf.readUInt8(p++) & 0x1f;
        fields.push({ num, size, base });
        totalSize += size;
      }
      // Developer fields are declared here and carry app-specific data. We skip
      // their bytes but must count them, or every following message misaligns.
      if (h & 0x20) {
        const devCount = buf.readUInt8(p++);
        for (let i = 0; i < devCount; i++) {
          const num = buf.readUInt8(p++);
          const size = buf.readUInt8(p++);
          p++; // developer data index
          fields.push({ num, size, base: 13, dev: true });
          totalSize += size;
        }
      }
      defs.set(local, { global, big, fields, totalSize });
      continue;
    }

    const def = defs.get(local);
    if (!def) throw new FitParseError("data before its definition");
    if (def.global === MSG.RECORD) records.push(decodeRow(buf, p, def, WANT_RECORD, SCALE_RECORD));
    else if (def.global === MSG.LAP) laps.push(decodeRow(buf, p, def, WANT_LAP, SCALE_LAP));
    else if (def.global === MSG.SESSION && !session) session = decodeRow(buf, p, def, WANT_SESSION, SCALE_SESSION);
    else if (def.global === MSG.FILE_ID && !fileId) fileId = decodeRow(buf, p, def, WANT_FILE_ID, {});
    p += def.totalSize;
  }

  if (!session) throw new FitParseError("no session in file — not an activity recording");

  return assemble(session, fileId, laps, records);
}

function assemble(session: Row, fileId: Row | null, lapRows: Row[], recordRows: Row[]): FitActivity {
  const startFit = session.get(F_SESSION.startTime) ?? 0;
  const startMs = FIT_EPOCH_MS + startFit * 1000;
  const startISO = new Date(startMs).toISOString();

  const sport = session.get(F_SESSION.sport) ?? 0;

  const samples: FitSample[] = [];
  for (const r of recordRows) {
    const ts = r.get(F_RECORD.timestamp);
    if (ts == null) continue;
    samples.push({
      t: ts - startFit,
      heartRate: r.get(F_RECORD.heartRate) ?? null,
      power: r.get(F_RECORD.power) ?? null,
    });
  }
  samples.sort((a, b) => a.t - b.t);

  return {
    externalId: fileIdOf(fileId, startFit),
    startISO,
    // The athlete's own calendar day. FIT stores UTC and no offset in file_id,
    // so this is the best available answer without inventing a timezone.
    date: startISO.slice(0, 10),
    sport,
    discipline: toDiscipline(sport),
    timerSeconds: Math.round(session.get(F_SESSION.totalTimer) ?? session.get(F_SESSION.totalElapsed) ?? 0),
    distanceM: session.get(F_SESSION.totalDistance) ?? null,
    calories: session.get(F_SESSION.totalCalories) ?? null,
    avgHeartRate: session.get(F_SESSION.avgHeartRate) ?? null,
    maxHeartRate: session.get(F_SESSION.maxHeartRate) ?? null,
    avgPower: session.get(F_SESSION.avgPower) ?? null,
    maxPower: session.get(F_SESSION.maxPower) ?? null,
    normalizedPower: session.get(F_SESSION.normalizedPower) ?? null,
    avgCadence: session.get(F_SESSION.avgCadence) ?? null,
    avgSpeedMS: session.get(F_SESSION.avgSpeed) ?? null,
    ascentM: session.get(F_SESSION.totalAscent) ?? null,
    laps: lapRows.map((l, i) => ({
      index: l.get(F_LAP.messageIndex) ?? i,
      seconds: Math.round(l.get(F_LAP.totalTimer) ?? l.get(F_LAP.totalElapsed) ?? 0),
      distanceM: l.get(F_LAP.totalDistance) ?? null,
      avgHeartRate: l.get(F_LAP.avgHeartRate) ?? null,
      maxHeartRate: l.get(F_LAP.maxHeartRate) ?? null,
      avgPower: l.get(F_LAP.avgPower) ?? null,
      maxPower: l.get(F_LAP.maxPower) ?? null,
      avgCadence: l.get(F_LAP.avgCadence) ?? null,
      avgSpeed: l.get(F_LAP.avgSpeed) ?? null,
      ascentM: l.get(F_LAP.totalAscent) ?? null,
    })),
    samples,
    dynamics: dynamicsOf(recordRows),
  };
}

/** Manufacturer + serial + creation time. Stable across re-downloads of the
 * same activity, and distinct between two athletes who rode together. */
function fileIdOf(fileId: Row | null, startFit: number): string {
  const manufacturer = fileId?.get(F_FILE_ID.manufacturer) ?? 0;
  const serial = fileId?.get(F_FILE_ID.serial) ?? 0;
  const created = fileId?.get(F_FILE_ID.timeCreated) ?? startFit;
  return `fit:${manufacturer}:${serial}:${created}`;
}

/** Average the running-dynamics channels over the records that carry them.
 * Records without them (a walk break, a device that stopped reporting) are left
 * out of the average rather than counted as zero. */
function dynamicsOf(rows: Row[]): RunningDynamics | null {
  const sums = { vo: 0, st: 0, vr: 0, sl: 0, bal: 0 };
  const counts = { vo: 0, st: 0, vr: 0, sl: 0, bal: 0 };

  for (const r of rows) {
    const add = (key: keyof typeof sums, num: number) => {
      const v = r.get(num);
      if (v != null) { sums[key] += v; counts[key]++; }
    };
    add("vo", F_RECORD.verticalOscillation);
    add("st", F_RECORD.stanceTime);
    add("vr", F_RECORD.verticalRatio);
    add("sl", F_RECORD.stepLength);
    add("bal", F_RECORD.stanceTimeBalance);
  }

  // Without contact time and oscillation there is no running-dynamics story to
  // tell, and a card showing two blanks is worse than no card.
  if (!counts.vo || !counts.st) return null;

  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    verticalOscillationMm: r1(sums.vo / counts.vo),
    stanceTimeMs: Math.round(sums.st / counts.st),
    verticalRatioPct: r1(sums.vr / Math.max(1, counts.vr)),
    stepLengthMm: Math.round(sums.sl / Math.max(1, counts.sl)),
    balancePct: counts.bal ? r1(sums.bal / counts.bal) : null,
  };
}
