// "Apaguem minha conta." Direito ao apagamento do RGPD.
//
// Apaga de verdade — sem carência, sem "desativado", sem cópia guardada por
// via das dúvidas. Um apagar que na verdade esconde é a coisa errada a fazer
// com um pedido de exclusão de dado pessoal, e o que este produto guarda é
// categoria especial: HRV, sono, dor, lesão, ciclo menstrual.
//
// A confirmação exige digitar o próprio e-mail. Não é burocracia: a chave é a
// única credencial, então quem chega aqui já tem acesso total, e a única
// proteção que ainda faz sentido é contra o próprio clique errado.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { deleteTenant, getTenantEmail } from "@/lib/product-db";
import { resolveTenantId } from "@/lib/data-product";
import { APP_COOKIE } from "@/app/api/app-login/route";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const jar = await cookies();
  const key = jar.get(APP_COOKIE)?.value;
  const tenantId = key ? await resolveTenantId(key) : null;
  if (!tenantId) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { confirm?: unknown } | null;
  const typed = typeof body?.confirm === "string" ? body.confirm.trim().toLowerCase() : "";
  const email = (await getTenantEmail(tenantId))?.toLowerCase() ?? null;
  if (!email || typed !== email) {
    return NextResponse.json({ ok: false, code: "confirm_mismatch" }, { status: 400 });
  }

  const r = await deleteTenant(tenantId);
  if (!r.ok) return NextResponse.json({ ok: false, code: "failed" }, { status: 500 });

  // A sessão passa a apontar para um tenant que não existe; limpar aqui evita
  // que a próxima navegação vire um erro em vez de uma despedida.
  const res = NextResponse.json({ ok: true });
  res.cookies.set(APP_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
