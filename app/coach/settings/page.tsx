// Coach panel settings. For an OWNER this is the agency's admin: who owns the
// place, what each professional programs, who looks after which athlete, and
// what an athlete is worth per month. A non-owner professional sees the team
// roster read-only — their own book is the /coach panel, not this.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveStaffId, listStaff } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";
import { pickLocale, translator, type Locale, type TKey } from "@/lib/i18n";
import { CoachNav } from "@/components/coach/CoachNav";
import { AddProfessional } from "@/components/coach/AddProfessional";
import { TeamAdmin } from "@/components/coach/TeamAdmin";

export const dynamic = "force-dynamic";

export default async function CoachSettingsPage() {
  const cookieKey = (await cookies()).get(COACH_COOKIE)?.value ?? null;
  if (!cookieKey) redirect("/coach/login");

  const staff = await resolveStaffId(cookieKey);
  if (!staff) redirect("/coach/login?erro=1");

  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);
  const team = await listStaff(staff.agencyId);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <CoachNav active="settings" role={staff.role} name={staff.name} locale={locale} isOwner={staff.isOwner} />

      <header className="mb-5 px-1">
        <h1 className="dsp text-[24px] font-extrabold text-[var(--text)]">
          {staff.isOwner ? tr("admin.title") : tr("coach.settings.teamTitle")}
        </h1>
        <p className="mt-0.5 text-[13px] text-[var(--text-faint)]">
          {staff.isOwner ? tr("admin.sub") : tr("coach.settings.teamSub")}
        </p>
      </header>

      {staff.isOwner ? (
        <div className="flex flex-col gap-5">
          <AddProfessional locale={locale} />
          <TeamAdmin team={team} locale={locale} />
        </div>
      ) : (
        // Read-only for a hired professional: seeing who else is on the team is
        // fine; changing assignments or reading prices is not.
        <div className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] p-5">
          <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
            {tr("coach.settings.teamTitle")} <span className="tnum text-[var(--text-faint)]">{team.length}</span>
          </h2>
          <ul className="flex flex-col divide-y divide-[var(--border-soft)]">
            {team.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-semibold text-[var(--text)]">{m.name ?? m.email ?? "—"}</p>
                  <p className="text-[11.5px] text-[var(--text-faint)]">{tr(`coach.role.${m.role}` as TKey)}</p>
                </div>
                <span className="shrink-0 text-[11.5px] text-[var(--text-muted)]">
                  <span className="tnum font-semibold">{m.athlete_count}</span> {tr("coach.settings.athletes")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
