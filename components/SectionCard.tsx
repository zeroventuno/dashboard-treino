import type { ReactNode } from "react";

/** MY TRAKR section card: bold title + descriptive subtitle, soft rounded surface. */
export function SectionCard({
  title, subtitle, action, children, className = "", bodyClass = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section
      className={`rise tcard rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] p-5 shadow-[var(--shadow)] sm:p-6 ${className}`}
    >
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && (
              <h2 className="dsp text-[20px] font-bold leading-tight text-[var(--text)]">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-[12.5px] text-[var(--text-faint)]">{subtitle}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}
