// "Perdi minha chave."
//
// A chave é a única credencial e só o hash dela é guardado, então não há o que
// reenviar — o que existe é ROTACIONAR. Isso é a resposta certa também em
// segurança: quem perdeu não sabe se perdeu ou se vazou, e uma chave nova
// resolve os dois casos.
//
// A rota responde SEMPRE a mesma coisa, exista o e-mail ou não. Um formulário
// público que responde diferente para endereço cadastrado é um verificador de
// quem usa o produto — e aqui a lista de usuários é uma lista de pessoas com
// dados de saúde no sistema.
import { NextResponse } from "next/server";
import { requestAthleteRecovery } from "@/lib/product-db";

export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!EMAIL.test(email)) {
    return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  }

  const origin = process.env.APP_ORIGIN?.trim().replace(/\/+$/, "");
  const mailHook = process.env.N8N_MAIL_WEBHOOK_URL?.trim();
  // Sem caminho de envio, a rota não pode fingir que mandou. Isso não vaza nada
  // — vale igual para e-mail cadastrado ou não — e é melhor que um "enviamos!"
  // silenciosamente falso para alguém trancado do lado de fora.
  if (!origin || !mailHook) {
    return NextResponse.json({ ok: false, code: "mail_unavailable" }, { status: 503 });
  }

  const made = await requestAthleteRecovery(email);

  // `made` é null tanto para e-mail inexistente quanto para "já existe um link
  // válido em aberto". Os dois casos terminam aqui, sem enviar nada e sem
  // contar ao chamador qual dos dois aconteceu.
  if (made) {
    await fetch(mailHook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "recover",
        email,
        name: made.name,
        url: `${origin}/app/setup/${made.token}`,
      }),
      // Falha de envio não pode virar erro na tela: a pessoa tentaria de novo e
      // esbarraria no "já existe um link aberto". O e-mail que não saiu aparece
      // no log do n8n, que é onde alguém consegue agir sobre isso.
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
