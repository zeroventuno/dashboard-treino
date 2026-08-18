// The agency's athletes: register them, fill in their details, say who looks
// after them and what they pay. Owner-only — this is where account keys are
// minted and where the fees live.
//
// Registration used to mean running provision.mjs from a terminal as the
// postgres superuser, which is fine for a founder and impossible for a customer.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveStaffId, listStaff, listAgencyAthletes } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";
import { pickLocale, translator, type Locale } from "@/lib/i18n";
import { CoachNav } from "@/components/coach/CoachNav";
import { AddAthlete } from "@/components/coach/AddAthlete";
import { AthleteAdmin } from "@/components/coach/AthleteAdmin";

export const dynamic = "force-dynamic";

export default async function CoachAthletesPage() {
  const cookieKey = (await cookies()).get(COACH_COOKIE)?.value ?? null;
  if (!cookieKey) redirect("/coach/login");

  const staff = await resolveStaffId(cookieKey);
  if (!staff) redirect("/coach/login?erro=1");
  if (!staff.isOwner) redirect("/coach");

  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);
  const [team, athletes] = await Promise.all([
    listStaff(staff.agencyId),
    listAgencyAthletes(staff.agencyId),
  ]);

  const mcpUrl = (process.env.MCP_CONNECTOR_URL ?? "https://dashboard-treino-zeroventunos-projects.vercel.app/api/mcp").split("?")[0];
  // APP_ORIGIN first — it is the variable the rest of the app actually reads
  // and the one that is set. This line asked for APP_URL, which nothing sets,
  // so it always fell through to the literal: every welcome message handed to
  // a new athlete carried the old domain even though the deployment was
  // correctly configured. APP_URL stays as a fallback so an existing
  // deployment that does define it keeps working.
  const origin = process.env.APP_ORIGIN?.trim().replace(/\/+$/, "");
  const appUrl = origin ? `${origin}/app` : (process.env.APP_URL ?? "https://mytrakr.fit/app");

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <CoachNav active="athletes" role={staff.role} name={staff.name} locale={locale} isOwner={staff.isOwner} />

      <header className="mb-5 px-1">
        <h1 className="dsp text-[24px] font-extrabold text-[var(--text)]">{tr("athletes.title")}</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">{tr("athletes.sub")}</p>
      </header>

      <div className="flex flex-col gap-5">
        <AddAthlete locale={locale} appUrl={appUrl} mcpUrl={mcpUrl} />
        <AthleteAdmin athletes={athletes} team={team} currency={staff.currency} locale={locale} />
      </div>
    </div>
  );
}
