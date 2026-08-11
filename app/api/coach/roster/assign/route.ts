// Pegar um aluno que está em carteira nenhuma.
//
// NÃO é owner-only, ao contrário de /reassign. Assumir um aluno que ninguém
// atende é alguém se oferecendo para trabalho parado; tirar um aluno de um
// colega redistribui a carteira dele e continua sendo decisão de dono. As duas
// rotas existem separadas justamente para que essa diferença não dependa de um
// `if` que alguém possa afrouxar depois.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { resolveStaffId, assignUnassignedAthlete } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const key = (await cookies()).get(COACH_COOKIE)?.value;
  const staff = key ? await resolveStaffId(key) : null;
  if (!staff) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { tenantId?: unknown; staffId?: unknown } | null;
  const tenantId = typeof body?.tenantId === "string" && UUID.test(body.tenantId) ? body.tenantId : null;
  // Sem staffId, o profissional está pegando para si. Um treinador designando
  // OUTRO profissional é distribuição de trabalho alheio, então isso continua
  // com o dono.
  const target = typeof body?.staffId === "string" && UUID.test(body.staffId) ? body.staffId : staff.id;
  if (!tenantId) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  if (target !== staff.id && !staff.isOwner) {
    return NextResponse.json({ ok: false, code: "forbidden" }, { status: 403 });
  }

  const r = await assignUnassignedAthlete(staff.agencyId, tenantId, target);
  if (r.ok) return NextResponse.json({ ok: true });
  // `taken` cobre "alguém pegou entre a tela carregar e você clicar" — que é
  // informação útil, não um erro do usuário.
  return NextResponse.json({ ok: false, code: r.code }, { status: r.code === "taken" ? 409 : 404 });
}
