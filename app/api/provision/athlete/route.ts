// Cria o convite de um atleta que acabou de pagar, e devolve o link mágico.
//
// Chamada pelo n8n a partir do webhook do gateway de pagamento. A rota só cria
// o CONVITE: a conta nasce quando a pessoa abre o link e confirma, então um
// pagamento cujo e-mail nunca foi aberto não deixa uma conta fantasma para trás
// — e a chave só passa a existir no momento em que é mostrada.
//
// Mesmo portão da rota de assessoria: segredo no header, comparado em tempo
// constante, fechado quando a env não está definida.
import { NextResponse } from "next/server";
import { createAthleteToken } from "@/lib/product-db";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";

function secretOk(given: string | null): boolean {
  const want = process.env.PROVISION_SECRET ?? "";
  if (!want || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  if (!secretOk(req.headers.get("x-provision-secret"))) {
    return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    | { email?: unknown; name?: unknown; locale?: unknown }
    | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!EMAIL.test(email)) {
    return NextResponse.json({ ok: false, code: "bad_request" }, { status: 400 });
  }

  const origin = process.env.APP_ORIGIN?.trim().replace(/\/+$/, "");
  // Recusa antes de gravar: o link é de uso único, e um sem domínio é um link
  // morto que a pessoa gastaria sem conseguir abrir.
  if (!origin) {
    return NextResponse.json(
      { ok: false, code: "no_app_origin", fix: "Defina APP_ORIGIN na Vercel (ex.: https://mytrakr.fit)" },
      { status: 503 },
    );
  }

  const invite = await createAthleteToken({
    kind: "signup",
    email,
    name: typeof body?.name === "string" ? body.name : null,
    locale: typeof body?.locale === "string" ? body.locale.slice(0, 5) : null,
  });
  if (!invite) return NextResponse.json({ ok: false, code: "no_db" }, { status: 503 });

  return NextResponse.json({
    ok: true,
    // O token em texto existe SÓ nesta resposta — não registre o corpo em log.
    url: `${origin}/app/setup/${invite.token}`,
    expiresAt: invite.expiresAt,
    email,
  });
}
