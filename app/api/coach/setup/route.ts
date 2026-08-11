// Gasta o convite: cria a assessoria e devolve a chave do dono, uma vez.
//
// POST e não GET de propósito. O link chega por e-mail, e provedores de e-mail
// abrem links para verificá-los — se o GET consumisse o convite, o antivírus do
// destinatário o queimaria antes de a pessoa ver a tela. A página faz GET para
// mostrar o que o convite promete; só o clique no botão gasta.
import { NextResponse } from "next/server";
import { redeemAgencyInvite } from "@/lib/product-db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : null;
  if (!token) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });

  const r = await redeemAgencyInvite(token);
  if (!r.ok) {
    // Uma resposta só para expirado, já usado e inexistente: distinguir contaria
    // a quem tem um token qualquer se ele já foi válido algum dia.
    return NextResponse.json({ ok: false, code: "invalid" }, { status: 410 });
  }
  // A chave em texto existe apenas aqui. Nada a registra em log — quem a perder
  // precisa de uma chave nova, que é o comportamento correto.
  return NextResponse.json({ ok: true, key: r.key, agencyName: r.agencyName });
}
