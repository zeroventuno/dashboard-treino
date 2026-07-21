import { translator, type Locale } from "@/lib/i18n";

/** First screen of a brand-new account.
 *
 * A tenant with no profile and no data would otherwise render eight empty
 * blocks — a dashboard that looks broken rather than new. This says what to do
 * instead, and disappears on its own as soon as the coach writes anything. */
export function Onboarding({
  locale,
  athlete,
  connectorUrl,
}: {
  locale: Locale;
  athlete: string | null;
  connectorUrl: string;
}) {
  const tr = translator(locale);

  const steps: { done: boolean; title: string; body?: string }[] = [
    { done: true, title: tr("onboarding.step1") },
    { done: false, title: tr("onboarding.step2"), body: connectorUrl },
    { done: false, title: tr("onboarding.step3"), body: tr("onboarding.step3.prompt") },
  ];

  return (
    <div className="mx-auto max-w-[640px] py-8">
      <div className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] p-7 shadow-[var(--shadow)] sm:p-9">
        <h1 className="dsp text-[26px] font-extrabold text-[var(--text)]">
          {athlete ? `${tr("onboarding.welcome")}, ${athlete}` : tr("onboarding.welcome")}
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
          {tr("onboarding.intro")}
        </p>

        <ol className="mt-7 space-y-5">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3.5">
              <span
                className="mt-[2px] grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold"
                style={{
                  background: s.done ? "var(--lime)" : "var(--surface-3)",
                  color: s.done ? "#0a0b0d" : "var(--text-faint)",
                }}
              >
                {s.done ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-[var(--text)]">{s.title}</p>
                {s.body && (
                  <p className="mt-1.5 break-all rounded-[10px] border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 font-mono text-[11.5px] leading-relaxed text-[var(--text-muted)]">
                    {s.body}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>

        <p className="mt-7 border-t border-[var(--border)] pt-5 text-[12.5px] leading-relaxed text-[var(--text-faint)]">
          {tr("onboarding.footer")}
        </p>
      </div>
    </div>
  );
}
