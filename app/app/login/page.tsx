// The athlete's login. Rendered before we know who they are, so there's no
// profile row to read a locale from — the language comes from the browser's
// Accept-Language header instead.

import { headers } from "next/headers";
import { pickLocale } from "@/lib/i18n";
import { LoginForm } from "./LoginForm";

export default async function AppLoginPage() {
  const locale = pickLocale((await headers()).get("accept-language"));
  return <LoginForm locale={locale} />;
}
