"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { translator, type Locale } from "@/lib/i18n";

/**
 * Ends the session by clearing the account-key cookie.
 *
 * The DELETE endpoint existed from the start but nothing ever called it, so
 * there was no way out of a dashboard: opening someone else's magic link — to
 * check what their account looks like — silently replaced your own session, and
 * the only escape was clearing browser cookies by hand.
 */
export function LogoutButton({ locale }: { locale: Locale }) {
  const tr = translator(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/app-login", { method: "DELETE" });
          router.push("/app/login");
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
      className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-[5px] text-[11.5px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)] disabled:opacity-50"
    >
      {tr("app.logout")}
    </button>
  );
}
