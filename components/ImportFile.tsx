// Manual .fit upload — the universal fallback. Works on every platform and
// every browser, unlike the PWA share_target it sits alongside (Android/Chrome
// only): a native form posting straight to /api/app/import, no client JS
// involved, so there's nothing here that can break independently of the route
// itself.
import { translator, type Locale, type TKey } from "@/lib/i18n";

const NOTICE: Record<string, TKey> = {
  ok: "import.notice.ok",
  no_file: "import.notice.noFile",
  parse_failed: "import.notice.parseFailed",
  unsupported_sport: "import.notice.unsupportedSport",
};

export function ImportFile({ locale, notice }: { locale: Locale; notice?: string }) {
  const tr = translator(locale);
  const noticeKey = notice ? NOTICE[notice] : undefined;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border border-[var(--border-soft)] bg-[var(--surface)] px-3.5 py-2.5">
      <span className="shrink-0 text-[12.5px] font-semibold text-[var(--text)]">{tr("import.title")}</span>
      <span className="min-w-0 flex-1 text-[11.5px] text-[var(--text-faint)]">{tr("import.hint")}</span>

      <form action="/api/app/import" method="post" encType="multipart/form-data" className="flex shrink-0 items-center gap-2">
        <input
          type="file"
          name="file"
          accept=".fit"
          required
          className="max-w-[160px] text-[11.5px] text-[var(--text-muted)] file:mr-2 file:rounded-full file:border file:border-[var(--border)] file:bg-[var(--surface-2)] file:px-2.5 file:py-1 file:text-[11px] file:font-semibold file:text-[var(--text)]"
        />
        <button
          type="submit"
          className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-3 py-[5px] text-[11.5px] font-semibold text-[var(--text)]"
        >
          {tr("import.button")}
        </button>
      </form>

      {noticeKey && (
        <p
          className="w-full text-[11.5px]"
          style={{ color: notice === "ok" ? "var(--good)" : "var(--text-muted)" }}
        >
          {tr(noticeKey)}
        </p>
      )}
    </div>
  );
}
