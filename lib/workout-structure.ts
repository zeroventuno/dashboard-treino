import type { Workout, WorkoutBlock } from "./types";

/**
 * Resolves a workout's interval blocks for the modal.
 *
 * Prefers the coach-authored `structure` field. Falls back to parsing
 * `zwo_content` — a .zwo already encodes exactly this (Warmup/SteadyState/
 * Intervals/Cooldown with durations and power as a fraction of FTP), so bike
 * workouts that ship a Zwift file get the block list and chart for free.
 */
export function getWorkoutBlocks(w: Workout): WorkoutBlock[] {
  if (Array.isArray(w.structure) && w.structure.length > 0) return w.structure;
  if (w.zwo_content) return parseZwo(w.zwo_content, w.planned_power_watts ?? null);
  return [];
}

const PT: Record<string, string> = {
  Warmup: "Aquecimento",
  Cooldown: "Volta à calma",
  SteadyState: "Bloco",
  FreeRide: "Livre",
  Ramp: "Progressivo",
};

/** Reads FTP out of a free-text power target like "220-230W" or "245W". */
function ftpFrom(plannedPower: string | null): number | null {
  if (!plannedPower) return null;
  const nums = plannedPower.match(/\d+/g);
  if (!nums?.length) return null;
  return Number(nums[nums.length - 1]);
}

/**
 * Minimal .zwo reader — regex over the workout elements rather than a full XML
 * parse, since we only need duration + power and the format is flat.
 * IntervalsT expands into its On/Off repeats so the chart shows the real shape.
 */
export function parseZwo(xml: string, plannedPower: string | null = null): WorkoutBlock[] {
  const body = xml.match(/<workout>([\s\S]*?)<\/workout>/)?.[1];
  if (!body) return [];

  const ftp = ftpFrom(plannedPower);
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
