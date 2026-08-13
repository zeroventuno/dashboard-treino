// "Me dê tudo que vocês têm sobre mim." Direito de portabilidade do RGPD.
//
// JSON e não PDF: portabilidade quer dizer formato que outra ferramenta
// consegue LER, não um relatório bonito que só serve para olhar.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { exportTenantData } from "@/lib/product-db";
import { resolveTenantId } from "@/lib/data-product";
import { APP_COOKIE } from "@/app/api/app-login/route";

export const dynamic = "force-dynamic";

export async function GET() {
  const key = (await cookies()).get(APP_COOKIE)?.value;
  const tenantId = key ? await resolveTenantId(key) : null;
  if (!tenantId) return NextResponse.json({ ok: false, code: "unauthorized" }, { status: 401 });

  const data = await exportTenantData(tenantId);
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="mytrakr-${stamp}.json"`,
      // Um arquivo com histórico de saúde não pode ficar em cache de proxy.
      "Cache-Control": "no-store, private",
    },
  });
}
