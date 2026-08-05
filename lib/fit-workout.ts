// ────────────────────────────────────────────────────────────────────────────
//  .fit workout writer — the run/swim counterpart of buildZwo().
//
//  A .fit is a binary Garmin format, so no AI can hand it over the way it hands
//  over a .zwo's XML: it has to be built in code. Same source of truth though —
//  the coach's `structure` blocks already carry duration and intensity, which is
//  exactly what a workout file encodes. The athlete downloads it and imports it
//  into Garmin Connect, and the watch then runs the session step by step.
//
//  Format (FIT SDK): a 14-byte header, then records, then a 2-byte CRC of
//  everything before it. Every record is either a DEFINITION (which fields a
//  local message type carries, and in what order) or DATA using one of those
//  definitions. Numbers are little-endian.
//
//  Only what a structured workout needs is implemented — file_id, workout and
//  workout_step. Strings are fixed-width because a definition fixes field sizes
//  for every data message that follows it.
// ────────────────────────────────────────────────────────────────────────────

import type { Workout, WorkoutBlock } from "./types";

// FIT's own CRC-16, nibble-table variant from the SDK.
const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400,
];

function crc16(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
  }
  return crc & 0xffff;
}

// Base type ids used below (high bit marks multi-byte types).
const T_ENUM = 0x00;
const T_UINT8 = 0x02;
const T_STRING = 0x07;
const T_UINT16 = 0x84;
const T_UINT32 = 0x86;
const T_UINT32Z = 0x8c;

/** FIT timestamps count from 1989-12-31, not the Unix epoch. */
const FIT_EPOCH_OFFSET = 631065600;

const NAME_BYTES = 32; // fixed width: one definition serves every step

class Writer {
  private bytes: number[] = [];
  u8(v: number) { this.bytes.push(v & 0xff); }
  u16(v: number) { this.u8(v); this.u8(v >> 8); }
  u32(v: number) { this.u16(v); this.u16(v >>> 16); }
  /** UTF-8, null-terminated, padded/truncated to `size` so it never runs past
   * the width the definition promised. */
  str(s: string, size: number) {
    const encoded = Array.from(new TextEncoder().encode(s)).slice(0, size - 1);
    for (const b of encoded) this.u8(b);
    for (let i = encoded.length; i < size; i++) this.u8(0);
  }
  raw(): Uint8Array { return Uint8Array.from(this.bytes); }
  get length() { return this.bytes.length; }
}

type FieldDef = [fieldNum: number, size: number, baseType: number];

function defineMessage(w: Writer, localType: number, globalNum: number, fields: FieldDef[]) {
  w.u8(0x40 | localType); // definition record
  w.u8(0); // reserved
  w.u8(0); // architecture: little-endian
  w.u16(globalNum);
  w.u8(fields.length);
  for (const [num, size, base] of fields) { w.u8(num); w.u8(size); w.u8(base); }
}

// ── Enums we actually use ───────────────────────────────────────────────────
const FILE_WORKOUT = 5;
const SPORT: Record<string, number> = { run: 1, bike: 2, swim: 5, strength: 10, rest: 0 };
const DURATION_TIME = 0;
const TARGET_OPEN = 2;
const TARGET_POWER = 4;
const INTENSITY = { active: 0, rest: 1, warmup: 2, cooldown: 3 } as const;

const WARMUP_WORDS = /aquec|warm|riscald|calent|échauff|echauff/i;
const COOLDOWN_WORDS = /volta à calma|volta a calma|cool ?down|defatic|enfriam|retour au calme|soltura/i;
const REST_WORDS = /recuper|rest|pausa|descanso|repos|riposo/i;

function stepIntensity(label: string, index: number, total: number): number {
  if (index === 0 && WARMUP_WORDS.test(label)) return INTENSITY.warmup;
  if (index === total - 1 && COOLDOWN_WORDS.test(label)) return INTENSITY.cooldown;
  if (REST_WORDS.test(label)) return INTENSITY.rest;
  return INTENSITY.active;
}

/** "Aquecimento · Z1" — the watch shows this, so the prescription rides along
 * even where we deliberately leave the target open. */
function stepName(b: WorkoutBlock): string {
  const label = (b.label ?? "").trim();
  const target = (b.target ?? "").trim();
  if (label && target && !label.includes(target)) return `${label} · ${target}`;
  return label || target || "Bloco";
}

/**
 * Build a Garmin .fit workout from a workout's blocks, or null when there's
 * nothing to structure.
 *
 * Every step is time-based, which is what the blocks describe. Targets: a bike
 * session gets a real power target (intensity is already % of threshold, and
 * that's exactly how FIT encodes percent-FTP), banded ±3% so the watch doesn't
 * alarm on an impossible exact number — the band is centred on the prescription,
 * so the average is still what the coach wrote. Run and swim get an OPEN target
 * on purpose: converting "% of threshold" into a pace band needs a threshold
 * pace we may not have, and a wrong pace alert is worse than none. The step name
 * carries the prescription instead.
 */
export function buildFitWorkout(w: Workout, blocks: WorkoutBlock[]): Uint8Array | null {
  const steps = blocks.filter((b) => (b.duration_min ?? 0) > 0);
  if (!steps.length) return null;

  const body = new Writer();

  // file_id — local type 0
  defineMessage(body, 0, 0, [
    [0, 1, T_ENUM],      // type
    [1, 2, T_UINT16],    // manufacturer
    [2, 2, T_UINT16],    // product
    [3, 4, T_UINT32Z],   // serial_number
    [4, 4, T_UINT32],    // time_created
  ]);
  body.u8(0);
  body.u8(FILE_WORKOUT);
  body.u16(255);  // manufacturer: development
  body.u16(0);
  body.u32(1);
  body.u32(Math.max(0, Math.floor(Date.now() / 1000) - FIT_EPOCH_OFFSET));

  // workout — local type 1
  defineMessage(body, 1, 26, [
    [4, 1, T_ENUM],           // sport
    [5, 4, T_UINT32Z],        // capabilities
    [6, 2, T_UINT16],         // num_valid_steps
    [8, NAME_BYTES, T_STRING] // wkt_name
  ]);
  body.u8(1);
  body.u8(SPORT[w.discipline] ?? 0);
  body.u32(32); // interval-capable
  body.u16(steps.length);
  body.str(w.title ?? "Workout", NAME_BYTES);

  // workout_step — local type 2
  defineMessage(body, 2, 27, [
    [254, 2, T_UINT16],        // message_index
    [0, NAME_BYTES, T_STRING], // wkt_step_name
    [1, 1, T_ENUM],            // duration_type
    [2, 4, T_UINT32],          // duration_value (ms for time)
    [3, 1, T_ENUM],            // target_type
    [4, 4, T_UINT32],          // target_value (0 = use the custom range)
    [5, 4, T_UINT32],          // custom_target_value_low
    [6, 4, T_UINT32],          // custom_target_value_high
    [7, 1, T_ENUM],            // intensity
  ]);

  steps.forEach((b, i) => {
    const usePower = w.discipline === "bike" && b.intensity != null && b.intensity > 0;
    // FIT reads power targets under 1000 as % of FTP — the same unit `intensity`
    // already uses, so no conversion and no invented watts.
    const pct = Math.round(b.intensity ?? 0);
    body.u8(2);
    body.u16(i);
    body.str(stepName(b), NAME_BYTES);
    body.u8(DURATION_TIME);
    body.u32(Math.max(1000, Math.round((b.duration_min ?? 0) * 60_000)));
    body.u8(usePower ? TARGET_POWER : TARGET_OPEN);
    body.u32(0);
    body.u32(usePower ? Math.max(0, pct - 3) : 0);
    body.u32(usePower ? pct + 3 : 0);
    body.u8(stepIntensity(b.label ?? "", i, steps.length));
  });

  const data = body.raw();

  // Header last — it carries the data size, and its own CRC covers bytes 0..11.
  const header = new Writer();
  header.u8(14);
  header.u8(0x20); // protocol 2.0
  header.u16(2140); // profile version
  header.u32(data.length);
  for (const ch of ".FIT") header.u8(ch.charCodeAt(0));
  const headerCrc = crc16(header.raw());
  header.u16(headerCrc);

  const withoutCrc = new Uint8Array(header.length + data.length);
  withoutCrc.set(header.raw(), 0);
  withoutCrc.set(data, header.length);

  const fileCrc = crc16(withoutCrc);
  const out = new Uint8Array(withoutCrc.length + 2);
  out.set(withoutCrc, 0);
  out[withoutCrc.length] = fileCrc & 0xff;
  out[withoutCrc.length + 1] = (fileCrc >> 8) & 0xff;
  return out;
}
