// A lista completa do que fazer — a mesma que o topo do painel mostra cortada,
// e o mesmo número que o sino carrega. Um cálculo só (lib/coach-signals), senão
// o sino e a lista divergiriam e o contador viraria mentira.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveStaffId } from "@/lib/product-db";
import { collectSignals } from "@/lib/coach-signals";
import { COACH_COOKIE } from "@/app/api/coach-login/route";
import { pickLocale, translator, type Locale } from "@/lib/i18n";
import { CoachNav } from "@/components/coach/CoachNav";
import { TodoList } from "@/components/coach/TodoList";

export const dynamic = "force-dynamic";

export default async function CoachNotificationsPage() {
  const cookieKey = (await cookies()).get(COACH_COOKIE)?.value ?? null;
  if (!cookieKey) redirect("/coach/login");

  const staff = await resolveStaffId(cookieKey);
  if (!staff) redirect("/coach/login?erro=1");

  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);
  const signals = await collectSignals(
    { id: staff.id, agencyId: staff.agencyId, role: staff.role, isOwner: staff.isOwner, timezone: staff.timezone },
    locale,
  );

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <CoachNav active="notifications" role={staff.role} name={staff.name} locale={locale} isOwner={staff.isOwner} />

      <header className="mb-5 px-1">
        <h1 className="dsp text-[24px] font-extrabold text-[var(--text)]">{tr("coach.notifications.title")}</h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">{tr("coach.notif.sub")}</p>
      </header>

      <TodoList signals={signals} tr={tr} />
    </div>
  );
}
