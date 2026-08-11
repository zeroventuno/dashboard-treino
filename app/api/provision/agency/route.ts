// Cria o convite de uma assessoria nova e devolve o link mágico.
//
// Quem chama é o n8n — hoje disparado à mão pelo Rafael, amanhã pelo webhook de
// pagamento do Stripe. A rota só cria o CONVITE: a assessoria nasce quando
// alguém abre o link e confirma, então um convite que ninguém usa não deixa
// nada para trás.
//
// Não usa o cookie do painel porque não existe sessão ainda — esta é a chamada
// que antecede a primeira conta. O portão é um segredo compartilhado no header.
import { NextResponse } from "next/server";
import { createAgencyInvite } from "@/lib/product-db";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";

/** Comparação em tempo constante: um `===` sobre segredo vaza o prefixo correto
 * pelo tempo de resposta, e esta rota cria assessorias. */
function secretOk(given: string | null): boolean {
  const want = process.env.PROVISION_SECRET ?? "";
  // Sem segredo configurado a rota fica FECHADA, nunca aberta: um deploy que
  // esqueceu a env não pode virar um endpoint público de criar assessoria.
  if (!want || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!secretOk(req.headers.get("x-provision-secret"))) {
    return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    agencyName?: unknown; ownerName?: unknown; ownerEmail?: unknown; currency?: unknown; days?: unknown;
  } | null;
  const agencyName = typeof body?.agencyName === "string" ? body.agencyName.trim() : "";
  if (!agencyName) return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });

  const invite = await createAgencyInvite({
    agencyName,
    ownerName: typeof body?.ownerName === "string" ? body.ownerName : null,
    ownerEmail: typeof body?.ownerEmail === "string" ? body.ownerEmail : null,
    currency: typeof body?.currency === "string" ? body.currency : null,
    days: typeof body?.days === "number" ? body.days : undefined,
  });
  if (!invite) return NextResponse.json({ ok: false, code: "no_db" }, { status: 503 });

  // APP_ORIGIN e não o Host do pedido: o link vai para um e-mail e precisa
  // apontar para o domínio canônico, não para o host que por acaso chamou.
  //
  // Sem ela, RECUSA. O convite já foi gravado, mas devolver "/coach/setup/…"
  // sem domínio mandaria um link quebrado por e-mail — e o convite é de uso
  // único, então a pessoa gastaria o dela num link que não abre. Falhar aqui
  // custa um convite morto no banco; a alternativa custa um cliente travado.
  const origin = process.env.APP_ORIGIN?.trim().replace(/\/+$/, "");
  if (!origin) {
    return NextResponse.json(
      { ok: false, code: "no_app_origin", fix: "Defina APP_ORIGIN na Vercel (ex.: https://seu-dominio.com)" },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    // O token em texto existe SÓ nesta resposta — só o hash foi gravado.
    url: `${origin}/coach/setup/${invite.token}`,
    expiresAt: invite.expiresAt,
    agencyName,
  });
}
