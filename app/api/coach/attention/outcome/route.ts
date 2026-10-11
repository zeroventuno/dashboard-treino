// Registrar o que aconteceu depois de um alerta de retenção.
//
// Quem pode: o dono, para qualquer aluno da assessoria; um profissional, só
// para quem está na carteira dele — o mesmo recorte que a tela de atenção lhe
// mostra. Um aluno fora desse recorte responde 404, igual a um que não existe:
// a rota não confirma que um id de outra carteira é real.
//
// O snapshot (estado, queda semanal, dias de silêncio, mensalidade) é
// recalculado AQUI a partir da linha viva da assessoria, nunca lido do corpo do
// pedido. O rótulo existe para alimentar uma análise; um rótulo cujas features
// vêm do navegador é um rótulo que qualquer um pode falsificar.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveStaffId, getAgencyAttention, recordAttentionOutcome } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";
import { assess } from "@/lib/retention";
import { parseOutcomeInput, type LatestOutcome } from "@/lib/attention-outcome";
import { todayInZone } from "@/lib/agency-clock";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const key = (await cookies()).get(COACH_COOKIE)?.value;
  const staff = key ? await resolveStaffId(key) : null;
  if (!staff) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { tenantId?: unknown; outcome?: unknown; reason?: unknown; note?: unknown }
    | null;
  const tenantId = typeof body?.tenantId === "string" && UUID.test(body.tenantId) ? body.tenantId : null;
  if (!tenantId) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });

  const parsed = parseOutcomeInput(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, code: parsed.code }, { status: 400 });

  // The live row, narrowed to what this person is allowed to see.
  const row = (await getAgencyAttention(staff.agencyId)).find((r) => r.tenant_id === tenantId);
  if (!row || (!staff.isOwner && !(row.staff_ids ?? []).includes(staff.id))) {
    return NextResponse.json({ ok: false, code: "not_found" }, { status: 404 });
  }
  const snapshot = assess(row, todayInZone(staff.timezone));

  const r = await recordAttentionOutcome({
    agencyId: staff.agencyId,
    staffId: staff.id,
    isOwner: staff.isOwner,
    tenantId,
    input: parsed.value,
    snapshot,
  });
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, code: r.code },
      // "unavailable" is the migration not having been run — the server's
      // state, not the request's fault.
      { status: r.code === "unavailable" ? 503 : 404 },
    );
  }

  const latest: LatestOutcome = {
    outcome: parsed.value.outcome,
    reason: parsed.value.reason,
    note: parsed.value.note,
    at: new Date().toISOString(),
    by: staff.name,
  };
  return NextResponse.json({ ok: true, latest });
}
