// ────────────────────────────────────────────────────────────────────────────
//  What the agency bills in — a CLOSED list, not free text.
//
//  `agencies.currency` is a plain text column, and every money figure in the
//  panel renders through it: `Intl.NumberFormat({ style: "currency" })` in the
//  athlete admin and the retention board, and a bare prefix on the scoreboard.
//  A typo doesn't fail politely. "EURO" or "eur" makes Intl throw a RangeError
//  mid-render — which blanks the screen the owner was looking at — and the
//  bare-prefix spots print the typo as though it were money.
//
//  So the owner picks instead of typing, and the write path refuses anything
//  not on this list. Same shape as LOCALES in lib/i18n.ts.
//
//  Short on purpose: the ones this product plausibly bills in. Adding one is a
//  one-line change here, which is precisely the point of it being a list.
// ────────────────────────────────────────────────────────────────────────────

export const CURRENCIES = ["EUR", "BRL", "USD", "GBP", "CHF"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** What add-owner-and-value.sql defaults the column to. */
export const DEFAULT_CURRENCY: Currency = "BRL";

export function isCurrency(v: unknown): v is Currency {
  return typeof v === "string" && (CURRENCIES as readonly string[]).includes(v);
}
