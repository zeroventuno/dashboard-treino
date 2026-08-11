// A tela do link mágico: confirma a assessoria e entrega a chave do dono.
//
// O GET só LÊ o convite (peek). Gastar é o clique — ver o comentário em
// /api/coach/setup sobre antivírus de e-mail abrindo links.
import { headers } from "next/headers";
import { peekAgencyInvite } from "@/lib/product-db";
import { pickLocale, translator, type Locale } from "@/lib/i18n";
import { SetupClaim } from "@/components/coach/SetupClaim";

export const dynamic = "force-dynamic";

export default async function AgencySetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);
  const invite = await peekAgencyInvite(token);

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-[560px] flex-col justify-center px-5 py-12">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-trakr.svg" alt="MY TRAKR" className="mb-6 h-[26px] w-auto" />

      {!invite ? (
        <div className="rounded-[16px] border border-[var(--border-soft)] bg-[var(--surface)] p-6">
          <h1 className="dsp text-[20px] font-extrabold text-[var(--text)]">{tr("setup.invalid")}</h1>
          <p className="mt-1.5 text-[13.5px] text-[var(--text-muted)]">{tr("setup.invalidSub")}</p>
        </div>
      ) : (
        <SetupClaim token={token} agencyName={invite.agencyName} ownerName={invite.ownerName} locale={locale} />
      )}
    </div>
  );
}
