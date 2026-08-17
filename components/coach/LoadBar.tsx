// ────────────────────────────────────────────────────────────────────────────
//  The roster-wide fatigue distribution — the coach's own programming, on one
//  line.
//
//  Every other element on /coach is about an athlete. This one is not: "how many
//  of my athletes are trending into high fatigue right now" is a question about
//  the WEEK THE COACH WROTE. One overreaching athlete is a person to call; a
//  third of the roster overreaching in the same week is a periodisation that
//  went too hard, and no amount of per-card marks makes that visible — the
//  reader has to count, and at forty athletes nobody counts.
//
//  So the summary is a proportion, not a list, and it names no one. The headline
//  is deliberately a FRACTION ("3 of 9") rather than a bare number: three
//  overreaching out of nine is a program problem, three out of two hundred is a
//  Tuesday.
//
//  NO STATE. Filtering rides a query string (?load=overreaching) rather than
//  React state, for three reasons: the board is a server component whose data
//  callbacks cannot cross to the client; the filtered view is then linkable and
//  survives a reload; and the whole page is already `force-dynamic`, so a
//  filtered render costs nothing extra.
//
//  The bar doubles as the LEGEND for the marks on the cards below — same four
//  colours, same four words, defined once in lib/roster-load-view.ts. That is
//  what lets the card get away with a bare coloured number instead of a label.
// ────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { LOAD_BANDS, LOAD_LABEL, LOAD_TONE, type LoadBand } from "@/lib/roster-load-view";
import type { TKey } from "@/lib/i18n";

export function LoadBar({
  counts,
  total,
  attention,
  active,
  basePath,
  tr,
}: {
  counts: Record<LoadBand, number>;
  total: number;
  /** overreaching + watch */
  attention: number;
  /** The band currently filtered to, or null for the whole roster. */
  active: LoadBand | null;
  /** Where a band link points — "/coach" or "/coach/demo". */
  basePath: string;
  tr: (k: TKey) => string;
}) {
  if (total === 0) return null;

  return (
    <section className="mb-4 rounded-[14px] border border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2.5 sm:px-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--text-faint)]">
          {tr("coach.load.title")}
        </h2>
        {/* The whole point of the block, in one sentence. Coloured only when
            there is something to colour — a roster with nobody in trouble
            should read as calm, not as a warning that happens to say zero. */}
        <p
          className="tnum text-[12px] font-semibold"
          style={{ color: attention > 0 ? "var(--warn)" : "var(--text-faint)" }}
        >
          {tr("coach.load.headline")
            .replace("{n}", String(attention))
            .replace("{t}", String(total))}
        </p>
      </div>

      {/* Proportion, at a glance. Decorative: every band it shows is also a
          labelled control below, so nothing here is the only way to reach
          anything. Empty bands are omitted rather than drawn at zero width. */}
      <div className="mt-2 flex h-[7px] gap-[2px] overflow-hidden rounded-full" aria-hidden>
        {LOAD_BANDS.filter((b) => counts[b] > 0).map((b) => (
          <span
            key={b}
            className="block rounded-full"
            style={{
              flexGrow: counts[b],
              flexBasis: 0,
              // `none` is drawn hollow — a dashed outline on nothing — for the
              // same reason the silent card is: absence gets its own language,
              // never a colour that could be read as a verdict.
              background: b === "none" ? "transparent" : LOAD_TONE[b],
              border: b === "none" ? "1px dashed var(--text-faint)" : undefined,
              opacity: active && active !== b ? 0.28 : 1,
            }}
          />
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {LOAD_BANDS.map((b) => {
          const n = counts[b];
          const on = active === b;
          const tone = LOAD_TONE[b];
          const inner = (
            <>
              <span
                className="shrink-0 rounded-full"
                style={{
                  width: 7,
                  height: 7,
                  // Filled for a reading, an empty ring for the absence of one —
                  // the same unlit-light mark the roster card uses.
                  background: b === "none" ? "transparent" : tone,
                  border: b === "none" ? "1px solid var(--text-muted)" : undefined,
                }}
                aria-hidden
              />
              <span className="tnum font-extrabold" style={{ color: b === "none" ? "var(--text-muted)" : tone }}>
                {n}
              </span>
              <span className={on ? "text-[var(--text)]" : "text-[var(--text-muted)]"}>{tr(LOAD_LABEL[b])}</span>
            </>
          );
          const cls =
            "flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11.5px] font-semibold transition-colors";
          // An empty band is not a filter — clicking it could only ever produce
          // an empty grid, so it renders as a fact rather than a control.
          return n === 0 ? (
            <span key={b} className={`${cls} border-[var(--border-soft)] opacity-40`}>
              {inner}
            </span>
          ) : (
            <Link
              key={b}
              href={on ? basePath : `${basePath}?load=${b}`}
              aria-pressed={on}
              className={`${cls} hover:bg-[var(--surface-2)]`}
              style={{
                borderColor: on ? tone : "var(--border-soft)",
                background: on ? `color-mix(in oklab, ${tone} 12%, transparent)` : undefined,
              }}
            >
              {inner}
            </Link>
          );
        })}
        {active && (
          <Link href={basePath} className="ml-0.5 text-[11.5px] font-semibold text-[var(--lime)] hover:underline">
            {tr("coach.load.clear")}
          </Link>
        )}
      </div>
    </section>
  );
}
