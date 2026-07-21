// The athlete's login. Rendered before we know who they are, so there's no
// profile row to read a locale from — the language comes from the browser's
// Accept-Language header instead.
//
// ?erro= carries why the magic link bounced them here: `not_found` (the key is
// genuinely unknown) vs `unavailable` (we couldn't reach the database). Those
// must not read the same — telling someone their key is wrong when the server
// is down sends them chasing a problem they don't have.

import { headers } from "next/headers";
import { pickLocale } from "@/lib/i18n";
import { LoginForm } from "./LoginForm";

export default async function AppLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const [{ erro }, h] = await Promise.all([searchParams, headers()]);
  const locale = pickLocale(h.get("accept-language"));

  // "1" is the legacy value from links already in the wild; treat it as unknown-key.
  const initialError =
    erro === "unavailable" ? "unavailable" : erro === "not_found" || erro === "1" ? "not_found" : null;

  return <LoginForm locale={locale} initialError={initialError} />;
}
