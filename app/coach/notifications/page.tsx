// Notifications = the signals a coach should act on, computed from the roster
// (red today, recent injury, gone quiet) plus workout-bank drafts awaiting
// validation. Every athlete row links to their drill-in.
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveStaffId, getRoster, getBank, type RosterAthlete } from "@/lib/product-db";
import { COACH_COOKIE } from "@/app/api/coach-login/route";
import { pickLocale, translator, type Locale } from "@/lib/i18n";
import { daysBetween, toISO } from "@/lib/utils";
import { CoachNav } from "@/components/coach/CoachNav";

export const dynamic = "force-dynamic";

type Signal = { severity: 0 | 1 | 2; text: string; href: string };

export default async function CoachNotificationsPage() {
  const cookieKey = (await cookies()).get(COACH_COOKIE)?.value ?? null;
  if (!cookieKey) redirect("/coach/login");

  const staff = await resolveStaffId(cookieKey);
  if (!staff) redirect("/coach/login?erro=1");

  const locale: Locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);
  const todayISO = toISO(new Date());
  const roster = await getRoster(staff.id);

  const signals: Signal[] = [];
  for (const a of roster) {
    const to = `/coach/a/${a.tenant_id}`;
    const who = a.athlete ?? a.name;
    if (a.today_reco === "red") signals.push({ severity: 0, text: `${who} — ${tr("coach.notif.red")}`, href: to });
    if (a.recent_injuries > 0) signals.push({ severity: 1, text: `${who} — ${tr("coach.notif.injury")}`, href: to });
    const ago = a.last_checkin ? daysBetween(a.last_checkin, todayISO) : null;
    if (ago === null || ago > 3) {
      signals.push({
        severity: 2,
        text: `${who} — ${ago === null ? tr("coach.noCheckin") : tr("coach.notif.stale").replace("{n}", String(ago))}`,
        href: to,
      });
    }
  }

  // Bank drafts awaiting validation (coach only).
  if (staff.role === "coach") {
    const drafts = (await getBank(staff.agencyId)).filter((w) => w.status === "draft").length;
    if (drafts > 0) {
      signals.push({ severity: 1, text: tr("coach.notif.drafts").replace("{n}", String(drafts)), href: "/coach/bank" });
    }
  }

  signals.sort((x, y) => x.severity - y.severity);
  const DOT = ["var(--bad)", "var(--warn)", "var(--text-faint)"];

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6">
      <CoachNav active="notifications" role={staff.role} name={staff.name} locale={locale} isOwner={staff.isOwner} />

      <header className="mb-5 px-1">
        <h1 className="dsp text-[24px] font-extrabold text-[var(--text)]">{tr("coach.notifications.title")}</h1>
      </header>

      {signals.length === 0 ? (
        <p className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] px-5 py-8 text-center text-[13.5px] text-[var(--text-faint)]">
          {tr("coach.notifications.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {signals.map((s, i) => (
            <li key={i}>
              <Link
                href={s.href}
                className="flex items-center gap-3 rounded-[12px] border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 transition-colors hover:border-[var(--border)]"
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: DOT[s.severity] }} />
                <span className="text-[13px] text-[var(--text)]">{s.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
