import { NextResponse } from "next/server";
import { setWorkoutStatus } from "@/lib/data";
import type { WorkoutStatus } from "@/lib/types";

const VALID: WorkoutStatus[] = ["planned", "done", "skipped", "modified"];

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body?.id || !VALID.includes(body.status)) {
    return NextResponse.json({ ok: false, error: "Requisição inválida." }, { status: 400 });
  }

  const result = await setWorkoutStatus(body.id, body.status, {
    actual_tss: body.actual_tss ?? undefined,
    notes: body.notes ?? undefined,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
