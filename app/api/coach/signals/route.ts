// Quantos itens a lista do dia tem, para o badge do sino.
//
// Rota própria em vez de prop em cada página: o sino vive no CoachNav, que é
// renderizado por TODAS as telas do painel, e passar a contagem adiante obrigaria
// cada página a calcular — N cálculos que sairiam de sincronia assim que alguém
// esquecesse um. Uma chamada do cliente mantém um número só, vindo do mesmo
// collectSignals que desenha a lista.
import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { resolveStaffId } from "@/lib/product-db";
import { collectSignals } from "@/lib/coach-signals";
import { COACH_COOKIE } from "@/app/api/coach-login/route";
import { pickLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function GET() {
  const key = (await cookies()).get(COACH_COOKIE)?.value;
  const staff = key ? await resolveStaffId(key) : null;
  // 200 com zero, não 401: o sino não é uma tela, e um erro aqui não deve
  // pintar de vermelho um painel que está funcionando.
  if (!staff) return NextResponse.json({ count: 0, urgent: 0 });

  const locale = pickLocale((await headers()).get("accept-language"));
  const signals = await collectSignals(
    { id: staff.id, agencyId: staff.agencyId, role: staff.role, isOwner: staff.isOwner, timezone: staff.timezone },
    locale,
  );
  return NextResponse.json({
    count: signals.length,
    /** Os de hoje — o badge fica vermelho só quando existe algo desta cor. */
    urgent: signals.filter((s) => s.severity === 0).length,
  });
}
