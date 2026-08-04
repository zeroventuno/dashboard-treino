// Kicks off the n8n workout-bank generation. The heavy lifting (per-modality AI
// agents, writing drafts to app.workout_bank) lives in the n8n workflow — this
// endpoint just authenticates the coach and forwards the request. n8n reads the
// coach's methodology and writes the generated workouts back as `draft`, which
// the coach then reviews on /coach/bank. See product/N8N_BANK_CONTRACT.md.
import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { resolveStaffId } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";

const SPORTS = ["swim", "bike", "run", "strength"];
const PHASES = ["Base", "Build", "Peak", "Taper"];

export async function POST(req: NextRequest) {
  const key = (await cookies()).get(COACH_COOKIE)?.value;
  const staff = key ? await resolveStaffId(key) : null;
  if (!staff || staff.role !== "coach") {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const webhook = process.env.N8N_BANK_WEBHOOK_URL;
  if (!webhook) {
    return NextResponse.json({ ok: false, code: "not_configured" }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { sports?: unknown; perPhase?: unknown; phases?: unknown };
  const sports = Array.isArray(body.sports) ? body.sports.filter((s) => SPORTS.includes(String(s))) : [];
  const perPhase = Number(body.perPhase);
  // Which cycle phases to generate for — default to all four when unspecified.
  const pickedPhases = Array.isArray(body.phases) ? body.phases.filter((p) => PHASES.includes(String(p))) : [];
  const phases = pickedPhases.length ? pickedPhases : PHASES;
  if (sports.length === 0 || !Number.isFinite(perPhase) || perPhase < 1 || perPhase > 20) {
    return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  }

  // The webhook does the generation; we just hand it who's asking + what to make.
  // A shared secret lets n8n confirm the call really came from us.
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.N8N_BANK_SECRET ? { "x-trakr-secret": process.env.N8N_BANK_SECRET } : {}),
      },
      body: JSON.stringify({ agencyId: staff.agencyId, staffId: staff.id, sports, perPhase, phases }),
    });
    if (!res.ok) {
      console.error("[bank/generate] n8n webhook returned", res.status);
      return NextResponse.json({ ok: false, code: "webhook_failed" }, { status: 502 });
    }
  } catch (err) {
    console.error("[bank/generate] n8n webhook unreachable:", err);
    return NextResponse.json({ ok: false, code: "webhook_unreachable" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
