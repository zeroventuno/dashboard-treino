// A tela do link mágico do atleta — cadastro pós-pagamento e recuperação de
// chave usam a mesma, porque são a mesma mecânica com finais diferentes.
//
// O GET só LÊ o token; gastar é o clique. Ver o comentário em /api/app/setup
// sobre antivírus de e-mail abrindo links.
import { headers } from "next/headers";
import { peekAthleteToken } from "@/lib/product-db";
import { pickLocale, translator, type Locale } from "@/lib/i18n";
import { AthleteClaim } from "@/components/AthleteClaim";

export const dynamic = "force-dynamic";

export default async function AthleteSetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);
  const info = await peekAthleteToken(token);

  const origin = process.env.APP_ORIGIN?.trim().replace(/\/+$/, "") ?? "";
  const connectorUrl = `${process.env.MCP_ORIGIN?.trim().replace(/\/+$/, "") || origin}/api/mcp`;

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-[620px] flex-col justify-center px-5 py-12">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-trakr.svg" alt="MY TRAKR" className="mb-6 h-[26px] w-auto" />

      {!info ? (
        <div className="rounded-[16px] border border-[var(--border-soft)] bg-[var(--surface)] p-6">
          <h1 className="dsp text-[20px] font-extrabold text-[var(--text)]">{tr("claim.invalid")}</h1>
          <p className="mt-1.5 text-[13.5px] text-[var(--text-muted)]">{tr("claim.invalidSub")}</p>
          <a href="/app/recuperar" className="mt-4 inline-block text-[13px] font-semibold text-[var(--lime)] hover:underline">
            {tr("claim.askNew")}
          </a>
        </div>
      ) : (
        <AthleteClaim
          token={token}
          kind={info.kind}
          email={info.email}
          name={info.name}
          locale={locale}
          connectorUrl={connectorUrl}
        />
      )}
    </div>
  );
}
