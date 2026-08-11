// Shared top bar for the coach panel: tabs (Equipe · Banco), a notifications bell
// and a settings gear (Tabler icons, same family as the sport icons), plus the
// professional's badge + logout. `demo` renders the public-preview variant.
import Link from "next/link";
import { translator, type Locale, type TKey } from "@/lib/i18n";
import { Icon } from "./icons";
import { CoachLogout } from "./CoachLogout";
import { AlertBell } from "./AlertBell";

type Tab = "team" | "bank" | "agency" | "athletes" | "settings" | "notifications";

const iconBtn =
  "grid h-8 w-8 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] transition-colors hover:border-[var(--text)] hover:text-[var(--text)]";

export function CoachNav({
  active,
  role,
  name,
  locale,
  demo = false,
  isOwner = false,
}: {
  active?: Tab;
  role: string;
  name?: string | null;
  locale: Locale;
  demo?: boolean;
  /** Owns the agency — the settings gear becomes agency admin, and the label
   * says so, because "coach" and "owner" are different jobs on the same person. */
  isOwner?: boolean;
}) {
  const tr = translator(locale);
  const roleLabel = tr(`coach.role.${role}` as TKey);
  const isCoach = role === "coach";

  const tabCls = (on: boolean) =>
    `rounded-full px-3 py-[5px] text-[12.5px] font-semibold transition-colors ${
      on ? "bg-[var(--surface-3)] text-[var(--text)]" : "text-[var(--text-muted)] hover:text-[var(--text)]"
    }`;

  return (
    <nav className="sticky top-0 z-40 -mx-4 mb-5 flex items-center justify-between gap-3 border-b border-[var(--border-soft)] bg-[rgba(38,43,52,0.82)] px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-trakr.svg" alt="MY TRAKR" className="h-[24px] w-auto shrink-0" />
        <div className="flex items-center gap-0.5">
          <Link href="/coach" className={tabCls(active === "team")}>
            {tr("coach.nav.team")}
          </Link>
          {isCoach && (
            <Link href="/coach/bank" className={tabCls(active === "bank")}>
              {tr("coach.bank.link")}
            </Link>
          )}
          {/* Blocks sit beside the bank because they are the same library at a
              bigger grain: single sessions there, multi-week templates here. */}
          {isCoach && (
            <Link href="/coach/blocks" className={tabCls(false)}>
              {tr("blocks.title")}
            </Link>
          )}
          {/* Everyone gets it — scoped to their own book unless they own the
              agency, in which case it's the whole thing. */}
          {isOwner && (
            <Link href="/coach/athletes" className={tabCls(active === "athletes")}>
              {tr("athletes.link")}
            </Link>
          )}
          <Link href="/coach/agency" className={tabCls(active === "agency")}>
            {isOwner ? tr("coach.nav.agency") : tr("agency.myBook")}
          </Link>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/* O demo não tem sessão, então o contador não teria o que contar. */}
        {demo ? (
          <Link href="/coach/notifications" className={iconBtn} aria-label={tr("coach.notifications.title")}>
            <Icon name="bell" size={17} />
          </Link>
        ) : (
          <AlertBell label={tr("coach.notifications.title")} className={iconBtn} />
        )}
        {/* An owner administers the agency here; a hired professional sees the
            team read-only. Either way the page is theirs to open. */}
        <Link href="/coach/settings" className={iconBtn} aria-label={tr("coach.settings.title")}>
          <Icon name="settings" size={17} />
        </Link>
        {demo ? (
          <span className="rounded-full border border-[var(--lime)] px-2.5 py-[5px] text-[11px] font-bold uppercase tracking-wide text-[var(--lime)]">
            Demo
          </span>
        ) : (
          <>
            <span className="hidden rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-[5px] text-[11.5px] font-medium text-[var(--text-muted)] sm:inline">
              {name ? `${name} · ${roleLabel}` : roleLabel}
            </span>
            <CoachLogout locale={locale} />
          </>
        )}
      </div>
    </nav>
  );
}
