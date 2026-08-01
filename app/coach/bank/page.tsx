// The agency's workout library: generate (via n8n), review drafts, validate.
// Coach-only. Reused when prescribing (list_bank / add_bank_workout tools).
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveStaffId, getBank } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";
import { pickLocale, translator, type Locale } from "@/lib/i18n";
import { BankView } from "@/components/coach/BankView";

export const dynamic = "force-dynamic";

export default async function CoachBankPage() {
  const cookieKey = (await cookies()).get(COACH_COOKIE)?.value ?? null;
  if (!cookieKey) redirect("/coach/login");

  const staff = await resolveStaffId(cookieKey);
  if (!staff) redirect("/coach/login?erro=1");
  // The workout bank is a coach thing; other roles have no business here.
  if (staff.role !== "coach") redirect("/coach");

  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);
  const items = await getBank(staff.agencyId);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <nav className="sticky top-0 z-40 -mx-4 mb-5 flex items-center justify-between gap-3 border-b border-[var(--border-soft)] bg-[rgba(38,43,52,0.82)] px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <Link
          href="/coach"
          className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        >
          <span aria-hidden>←</span> {tr("coach.team")}
        </Link>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-trakr.svg" alt="MY TRAKR" className="h-[24px] w-auto" />
      </nav>

      <header className="mb-5 px-1">
        <h1 className="dsp text-[24px] font-extrabold text-[var(--text)]">{tr("coach.bank.title")}</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">{tr("coach.bank.sub")}</p>
      </header>

      <BankView items={items} locale={locale} />
    </div>
  );
}
