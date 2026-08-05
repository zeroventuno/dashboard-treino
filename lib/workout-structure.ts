import type { Workout, WorkoutBlock } from "./types";

/**
 * Resolves a workout's interval blocks for the modal.
 *
 * Prefers the coach-authored `structure` field. Falls back to parsing
 * `zwo_content` — a .zwo already encodes exactly this (Warmup/SteadyState/
 * Intervals/Cooldown with durations and power as a fraction of FTP), so bike
 * workouts that ship a Zwift file get the block list and chart for free.
 */
export function getWorkoutBlocks(w: Workout, ftpWatts?: number | null): WorkoutBlock[] {
  if (Array.isArray(w.structure) && w.structure.length > 0) return w.structure;
  if (w.zwo_content) return parseZwo(w.zwo_content, ftpWatts ?? null);
  return [];
}

const PT: Record<string, string> = {
  Warmup: "Aquecimento",
  Cooldown: "Volta à calma",
  SteadyState: "Bloco",
  FreeRide: "Livre",
  Ramp: "Progressivo",
};

/**
 * Minimal .zwo reader — regex over the workout elements rather than a full XML
 * parse, since we only need duration + power and the format is flat.
 * IntervalsT expands into its On/Off repeats so the chart shows the real shape.
 *
 * `ftpWatts` MUST be the athlete's threshold power (performance_indicators.
 * ftp_watts) — .zwo stores power as a fraction of FTP. Never pass a workout's
 * target range here: scaling 0.70 by a 136W *target* yields 95W instead of the
 * real 119W, i.e. numbers the athlete would train by, silently wrong. When FTP
 * is unknown we show "% FTP" rather than inventing watts.
 */
export function parseZwo(xml: string, ftpWatts: number | null = null): WorkoutBlock[] {
  const body = xml.match(/<workout>([\s\S]*?)<\/workout>/)?.[1];
  if (!body) return [];

  const ftp = ftpWatts && ftpWatts > 0 ? ftpWatts : null;
  const blocks: WorkoutBlock[] = [];
  const attr = (tag: string, name: string) => {
    const m = tag.match(new RegExp(`${name}="([^"]*)"`));
    return m ? Number(m[1]) : null;
  };
  const watts = (pct: number | null) =>
    pct != null && ftp ? `${Math.round(pct * ftp)}W` : pct != null ? `${Math.round(pct * 100)}% FTP` : null;

  for (const tag of body.match(/<(Warmup|Cooldown|SteadyState|FreeRide|Ramp|IntervalsT)\b[^>]*\/?>/g) ?? []) {
    const kind = tag.match(/<(\w+)/)![1];

    if (kind === "IntervalsT") {
      const repeat = attr(tag, "Repeat") ?? 1;
      const onDur = attr(tag, "OnDuration") ?? 0;
      const offDur = attr(tag, "OffDuration") ?? 0;
      const onPow = attr(tag, "OnPower");
      const offPow = attr(tag, "OffPower");
      for (let i = 1; i <= repeat; i++) {
        blocks.push({
          label: `Intervalo ${i}/${repeat}`,
          duration_min: onDur / 60,
          intensity: onPow != null ? onPow * 100 : null,
          target: watts(onPow),
        });
        if (offDur > 0) {
          blocks.push({
            label: "Recuperação",
            duration_min: offDur / 60,
            intensity: offPow != null ? offPow * 100 : null,
            target: watts(offPow),
          });
        }
      }
      continue;
    }

    const dur = attr(tag, "Duration") ?? 0;
    const low = attr(tag, "PowerLow");
    const high = attr(tag, "PowerHigh");
    const power = attr(tag, "Power") ?? (low != null && high != null ? (low + high) / 2 : low ?? high);
    blocks.push({
      label: PT[kind] ?? kind,
      duration_min: dur / 60,
      intensity: power != null ? power * 100 : null,
      target:
        low != null && high != null && low !== high
          ? `${watts(low)} → ${watts(high)}`
          : watts(power),
    });
  }

  return blocks;
}

// ── .zwo generation ─────────────────────────────────────────────────────────
// The reverse of parseZwo. Asking the AI to hand-write Zwift XML for every bike
// session doesn't survive contact with reality — it's a laborious optional
// field, so it gets skipped and the download button never appears. But
// `structure` already carries exactly what a .zwo encodes (duration + intensity
// as % of threshold), and the briefing insists on it for every workout. So we
// synthesize the file instead of asking for it: any bike session with blocks
// becomes a Zwift/MyWhoosh file, deterministically.

const WARMUP_WORDS = /aquec|warm|riscald|calent|échauff|echauff/i;
const COOLDOWN_WORDS = /volta à calma|volta a calma|cool ?down|defatic|enfriam|retour au calme|soltura/i;

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Build a Zwift .zwo from a workout's blocks, or null when there's nothing to
 * ride by — a file of pure free-rides would be a download that does nothing.
 * Power is written as a fraction of FTP, which is what .zwo means by "Power";
 * blocks with no intensity become FreeRide so the time still exists.
 */
export function buildZwo(w: Workout, blocks: WorkoutBlock[]): string | null {
  if (!blocks.length || !blocks.some((b) => b.intensity != null && b.intensity > 0)) return null;

  const elements = blocks.map((b, i) => {
    const seconds = Math.max(1, Math.round((b.duration_min ?? 0) * 60));
    if (b.intensity == null || b.intensity <= 0) return `    <FreeRide Duration="${seconds}"/>`;
    const power = (b.intensity / 100).toFixed(3);
    const label = b.label ?? "";
    // A warm-up/cool-down ramps rather than sitting flat, which is how Zwift
    // renders them too — first/last block only, so a mid-session "aquecimento
    // do bloco" doesn't turn into a ramp. The ramp is centred on the prescribed
    // intensity (±15%), so the average load still equals what the coach wrote:
    // shape is ours to choose, the prescription isn't.
    const lo = ((b.intensity * 0.85) / 100).toFixed(3);
    const hi = ((b.intensity * 1.15) / 100).toFixed(3);
    if (i === 0 && WARMUP_WORDS.test(label)) {
      return `    <Warmup Duration="${seconds}" PowerLow="${lo}" PowerHigh="${hi}"/>`;
    }
    if (i === blocks.length - 1 && COOLDOWN_WORDS.test(label)) {
      return `    <Cooldown Duration="${seconds}" PowerLow="${hi}" PowerHigh="${lo}"/>`;
    }
    const text = label ? `\n      <textevent timeoffset="0" message="${xmlEscape(label)}"/>\n    ` : "";
    return text
      ? `    <SteadyState Duration="${seconds}" Power="${power}">${text}</SteadyState>`
      : `    <SteadyState Duration="${seconds}" Power="${power}"/>`;
  });

  return `<workout_file>
  <author>MY TRAKR</author>
  <name>${xmlEscape(w.title)}</name>
  <description>${xmlEscape(w.description ?? "")}</description>
  <sportType>bike</sportType>
  <workout>
${elements.join("\n")}
  </workout>
</workout_file>
`;
}

/** "1h40" / "45min" — compact, for block rows. */
export function fmtBlockDuration(min: number): string {
  const total = Math.round(min);
  if (total >= 60) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
  }
  return `${total}min`;
}
