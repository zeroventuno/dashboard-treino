// The front door — what the world sees when it types mytrakr.fit.
//
// Until "/" moved, this address served the owner's personal IRONMAN dashboard
// behind the shared password, so a product domain answered with a password
// prompt for one athlete's training data. That dashboard now lives at /me.
//
// This is deliberately NOT the marketing landing page. It doesn't claim
// features, quote prices or promise a trial — none of that is decided yet, and
// a front door that oversells is worse than one that just opens. It does the
// one job that matters today: get an athlete and a professional to their own
// panel without either of them having to know a URL.
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { pickLocale, translator } from "@/lib/i18n";
import { Tagline } from "@/components/Tagline";

export const metadata: Metadata = {
  title: "MY TRAKR",
  description: "The training dashboard your AI — or your coaching team — fills in for you.",
};

export default async function HomePage() {
  // Nobody is signed in here, so there is no stored preference to read. The
  // browser's language is the only thing we know about this visitor, and it's
  // the same signal /app/login already trusts.
  const locale = pickLocale((await headers()).get("accept-language"));
  const tr = translator(locale);

  const doors = [
    { href: "/app", title: tr("home.athlete"), sub: tr("home.athleteSub"), primary: true },
    { href: "/coach", title: tr("home.coach"), sub: tr("home.coachSub"), primary: false },
  ];

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-9 p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-trakr.svg" alt="MY TRAKR" className="h-[38px] w-auto" />
        <Tagline />
        <p className="max-w-[30rem] text-balance text-[14px] leading-relaxed text-[var(--text-muted)]">
          {tr("home.lead")}
        </p>
      </div>

      <div className="grid w-full max-w-[38rem] grid-cols-1 gap-3 sm:grid-cols-2">
        {doors.map((d) => (
          <Link
            key={d.href}
            href={d.href}
            className="pop group rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5 transition-colors hover:border-[var(--lime)]"
          >
            <p className="text-[15px] font-extrabold text-[var(--text)]">{d.title}</p>
            <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">{d.sub}</p>
            <span
              className="mt-3 inline-block text-[12px] font-bold"
              style={{ color: d.primary ? "var(--lime)" : "var(--text-faint)" }}
            >
              →
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
