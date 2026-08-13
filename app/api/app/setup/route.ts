// Gasta o link mágico do atleta: cria a conta, ou rotaciona a chave de quem
// perdeu a dele. Devolve a chave em texto — uma vez.
//
// POST e não GET de propósito: provedores de e-mail abrem links para escaneá-los,
// e um GET que consumisse o token o queimaria antes de a pessoa ver a tela. A
// página faz GET para mostrar o que o link promete; só o clique gasta.
import { NextResponse } from "next/server";
import { redeemAthleteToken } from "@/lib/product-db";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token : null;
  if (!token) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });

  const r = await redeemAthleteToken(token);
  if (r.ok) {
    // A chave em texto existe apenas aqui. Nada a registra em log.
    return NextResponse.json({ ok: true, key: r.key, kind: r.kind });
  }

  // `duplicate_email` é dito porque é acionável e não vaza nada que a pessoa já
  // não saiba: ela acabou de provar que tem acesso a este e-mail abrindo o
  // link. Mandá-la para a recuperação é melhor que um "inválido" que a deixa
  // sem entender que a conta dela já existe.
  if (r.code === "duplicate_email") {
    return NextResponse.json({ ok: false, code: "duplicate_email" }, { status: 409 });
  }
  // Expirado, já usado e inexistente compartilham uma resposta só: distinguir
  // contaria a quem tem um token qualquer se ele já foi válido algum dia.
  return NextResponse.json({ ok: false, code: "invalid" }, { status: 410 });
}
