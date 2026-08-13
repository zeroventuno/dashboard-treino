// "Perdi minha chave." Fica sob /app porque esse prefixo já é público no
// proxy — quem perdeu a chave está trancado do lado de fora e não pode esbarrar
// no gate de senha compartilhada no caminho.
import { headers } from "next/headers";
import { pickLocale, translator, type Locale } from "@/lib/i18n";
import { RecoverForm } from "@/components/RecoverForm";

export const dynamic = "force-dynamic";

export default async function RecoverPage() {
  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-[480px] flex-col justify-center px-5 py-12">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-trakr.svg" alt="MY TRAKR" className="mb-6 h-[26px] w-auto" />
      <div className="rounded-[16px] border border-[var(--border-soft)] bg-[var(--surface)] p-6">
        <h1 className="dsp text-[20px] font-extrabold text-[var(--text)]">{tr("recover.title")}</h1>
        <p className="mt-1.5 text-[13.5px] text-[var(--text-muted)]">{tr("recover.sub")}</p>
        <RecoverForm locale={locale} />
      </div>
    </div>
  );
}
