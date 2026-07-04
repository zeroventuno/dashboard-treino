import type { ReactNode } from "react";

export function Card({
  children, className = "", title, action, style,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  action?: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <section
      className={`rise rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow)] sm:p-6 ${className}`}
      style={style}
    >
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--text-faint)]">
              {title}
            </h2>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
