// A lista do dia. Mesma marcação na página de notificações e no topo do painel,
// para que "o que tenho a fazer" tenha UMA aparência só onde quer que apareça.
import Link from "next/link";
import type { Signal } from "@/lib/coach-signals";
import type { T } from "@/lib/i18n";

const DOT = ["var(--bad)", "var(--warn)", "var(--text-faint)"] as const;

export function TodoList({
  signals,
  tr,
  /** Corta a lista e mostra "ver todas" — usado no topo do painel, onde a lista
   * é um chamado à ação e não o conteúdo da página. */
  limit,
}: {
  signals: Signal[];
  tr: T;
  limit?: number;
}) {
  if (signals.length === 0) {
    return (
      <p className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] px-5 py-8 text-center text-[13.5px] text-[var(--text-faint)]">
        {tr("coach.notifications.empty")}
      </p>
    );
  }

  const shown = limit ? signals.slice(0, limit) : signals;

  return (
    <>
      <ul className="flex flex-col gap-2">
        {shown.map((s, i) => (
          <li key={`${s.kind}-${i}`}>
            <Link
              href={s.href}
              className="flex items-center gap-3 rounded-[12px] border border-[var(--border-soft)] bg-[var(--surface)] px-4 py-3 transition-colors hover:border-[var(--border)]"
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: DOT[s.severity] }} />
              <span className="text-[13px] text-[var(--text)]">{s.text}</span>
            </Link>
          </li>
        ))}
      </ul>
      {limit && signals.length > limit && (
        <Link
          href="/coach/notifications"
          className="mt-2 inline-block text-[12.5px] font-semibold text-[var(--lime)] hover:underline"
        >
          {tr("coach.notif.seeAll").replace("{n}", String(signals.length))}
        </Link>
      )}
    </>
  );
}
