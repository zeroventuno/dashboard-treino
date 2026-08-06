"use client";

import { useMemo, useState } from "react";
import { normalizeTag, SUGGESTED_TAGS } from "@/lib/bank-tags";
import { translator, type Locale } from "@/lib/i18n";

/**
 * Inline tag editing on a library card. It lives on the card rather than in the
 * modal because retagging is a sweep — you fix five items in a row — and opening
 * a modal for each would be the slow way to do exactly that.
 *
 * Suggestions come from the shared vocabulary plus whatever the bank already
 * uses, filtered by what's typed, so a coach converges on existing spellings
 * instead of inventing a third one.
 */
export function TagEditor({
  id,
  tags,
  bankTags,
  locale,
  onSaved,
  onCancel,
}: {
  id: string;
  tags: string[];
  /** Tags already in use across the agency's bank — first-class suggestions. */
  bankTags: string[];
  locale: Locale;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const tr = translator(locale);
  const [draft, setDraft] = useState<string[]>(tags);
  const [input, setInput] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");

  const pool = useMemo(() => {
    const seen = new Set<string>();
    // The bank's own vocabulary first: it's what the filters already show.
    return [...bankTags, ...SUGGESTED_TAGS].filter((t) => (seen.has(t) ? false : seen.add(t)));
  }, [bankTags]);

  const typed = normalizeTag(input);
  const suggestions = pool.filter((t) => !draft.includes(t) && (typed ? t.includes(typed) : true)).slice(0, 8);

  function add(raw: string) {
    const t = normalizeTag(raw);
    if (!t) return;
    setDraft((d) => (d.includes(t) ? d : [...d, t]));
    setInput("");
  }

  async function save() {
    setState("saving");
    try {
      const res = await fetch("/api/coach/bank/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, tags: draft }),
      });
      if (!res.ok) throw new Error("save failed");
      onSaved();
    } catch {
      setState("error");
    }
  }

  return (
    <div className="mt-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] p-2.5">
      {draft.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {draft.map((t) => (
            <span
              key={t}
              className="flex items-center gap-1 rounded-[6px] bg-[var(--bg-soft)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--text-muted)]"
            >
              #{t}
              <button
                type="button"
                onClick={() => setDraft((d) => d.filter((x) => x !== t))}
                aria-label={`${tr("coach.bank.removeTag")} ${t}`}
                className="text-[var(--text-faint)] transition-colors hover:text-[var(--bad)]"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          // Enter/comma commit; backspace on an empty box removes the last chip,
          // which is what every tag input everywhere does.
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(input); }
          else if (e.key === "Backspace" && !input) setDraft((d) => d.slice(0, -1));
        }}
        placeholder={tr("coach.bank.tagPlaceholder")}
        className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-[11.5px] text-[var(--text)] outline-none focus:border-[var(--lime)]"
      />

      {suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {suggestions.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => add(t)}
              className="rounded-[6px] border border-[var(--border)] px-1.5 py-0.5 text-[10.5px] text-[var(--text-faint)] transition-colors hover:border-[var(--lime)] hover:text-[var(--lime)]"
            >
              +{t}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={save}
          disabled={state === "saving"}
          className="rounded-[8px] bg-[var(--lime)] px-2.5 py-1 text-[11.5px] font-bold text-[#0a0b0d] disabled:opacity-40"
        >
          {state === "saving" ? "…" : tr("coach.bank.saveTags")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-[8px] border border-[var(--border)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--text-faint)] hover:text-[var(--text-muted)]"
        >
          {tr("coach.bank.cancel")}
        </button>
        {state === "error" && <span className="text-[11px] text-[var(--bad)]">{tr("coach.bank.tagsError")}</span>}
      </div>
    </div>
  );
}
