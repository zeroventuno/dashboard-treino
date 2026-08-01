// The professional's login for the coach panel. Rendered before we know who
// they are, so the language comes from the browser's Accept-Language header.
import { headers } from "next/headers";
import { pickLocale } from "@/lib/i18n";
import { CoachLoginForm } from "./CoachLoginForm";

export default async function CoachLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const [{ erro }, h] = await Promise.all([searchParams, headers()]);
  const locale = pickLocale(h.get("accept-language"));

  const initialError =
    erro === "unavailable" ? "unavailable" : erro === "not_found" || erro === "1" ? "not_found" : null;

  return <CoachLoginForm locale={locale} initialError={initialError} />;
}
