"use client";

import { useRouter } from "next/navigation";
import { translator, type Locale } from "@/lib/i18n";

/** Ends the professional's session (clears the coach cookie) and returns to the
 * coach login. Mirrors the athlete LogoutButton but hits /api/coach-login. */
export function CoachLogout({ locale }: { locale: Locale }) {
  const tr = translator(locale);
  const router = useRouter();

  async function logout() {
    await fetch("/api/coach-login", { method: "DELETE" }).catch(() => {});
    router.push("/coach/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={logout}
      className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-[5px] text-[11.5px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--text)] hover:text-[var(--text)]"
    >
      {tr("app.logout")}
    </button>
  );
}
