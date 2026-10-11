"use client";

// "O que aconteceu depois do alerta?" — sits at the end of a row of the
// retention list.
//
// Shows the athlete's latest recorded outcome as a chip and opens an inline
// form to add the next one. Events only ever get appended (a wrong one is
// corrected by a newer one), so there is no edit state here.
//
// A sibling of the row's link, never a child of it: a click inside a form must
// not also navigate to the athlete.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { translator, type Locale, type TKey } from "@/lib/i18n";
import {
  NOTE_MAX, OUTCOMES, REASONS, daysAgo,
  type LatestOutcome, type OutcomeKind, type OutcomeReason,
} from "@/lib/attention-outcome";

const CHIP_COLOR: Record<OutcomeKind, string> = {
  contacted: "var(--text-muted)",
  stayed: "var(--good)",
  left: "var(--bad)",
};

const field =
  "rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-[12.5px] text-[var(--text)]";

export function OutcomeControl({
  tenantId,
  latest,
  todayISO,
  locale,
}: {
  tenantId: string;
  latest: LatestOutcome | null;
  todayISO: string;
  locale: Locale;
}) {
  const tr = translator(locale);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<OutcomeKind | null>(null);
  const [reason, setReason] = useState<OutcomeReason | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const canSave = outcome !== null && (outcome !== "left" || reason !== "");

  function close() {
    setOpen(false);
    setOutcome(null);
    setReason("");
    setNote("");
    setFailed(false);
  }

  async function save() {
    if (!canSave || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/coach/attention/outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId,
          outcome,
          ...(outcome === "left" ? { reason } : {}),
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setFailed(true);
        return;
      }
      close();
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const detail = latest
    ? [
        latest.reason ? tr(`agency.reason.${latest.reason}` as TKey) : null,
        latest.note,
        latest.by,
      ].filter(Boolean).join(" · ")
    : "";

  return (
    <div className="contents">
      {/* Its own line on a phone: sharing the row with the athlete's link left
          the name ~100px and truncated every one of them. */}
      <span className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
        {latest && (
          <span
            title={detail || undefined}
            className="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase"
            style={{ borderColor: CHIP_COLOR[latest.outcome], color: CHIP_COLOR[latest.outcome] }}
          >
            {tr(`agency.outcome.chip.${latest.outcome}` as TKey)} · {daysAgo(latest.at, todayISO)}
            {tr("agency.days")}
          </span>
        )}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => (open ? close() : setOpen(true))}
          className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-[3px] text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {tr("agency.outcome.record")}
        </button>
      </span>

      {open && (
        <div className="mt-1 flex w-full flex-col gap-2.5 border-t border-[var(--border-soft)] pt-3">
          <p className="text-[12px] font-semibold text-[var(--text)]">{tr("agency.outcome.title")}</p>

          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={tr("agency.outcome.title")}>
            {OUTCOMES.map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={outcome === o}
                onClick={() => setOutcome(o)}
                className="rounded-full border px-3 py-[5px] text-[12px] font-semibold"
                style={{
                  borderColor: outcome === o ? CHIP_COLOR[o] : "var(--border)",
                  color: outcome === o ? CHIP_COLOR[o] : "var(--text-muted)",
                  background: outcome === o ? "var(--surface-2)" : "transparent",
                }}
              >
                {tr(`agency.outcome.${o}` as TKey)}
              </button>
            ))}
          </div>

          {outcome === "left" && (
            <label className="flex flex-col gap-1 text-[11px] text-[var(--text-faint)]">
              {tr("agency.outcome.reason")}
              <select
                value={reason}
                onChange={(e) => setReason(e.target.value as OutcomeReason | "")}
                className={field}
              >
                <option value="">{tr("agency.outcome.reasonPick")}</option>
                {REASONS.map((r) => (
                  <option key={r} value={r}>{tr(`agency.reason.${r}` as TKey)}</option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1 text-[11px] text-[var(--text-faint)]">
            {tr("agency.outcome.note")}
            <input
              type="text"
              value={note}
              maxLength={NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              className={field}
            />
          </label>

          {failed && <p className="text-[11.5px]" style={{ color: "var(--bad)" }}>{tr("agency.outcome.failed")}</p>}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={!canSave || busy}
              className="rounded-full bg-[var(--lime)] px-3.5 py-[5px] text-[12px] font-bold text-[#0a0b0d] disabled:opacity-40"
            >
              {busy ? tr("agency.outcome.saving") : tr("agency.outcome.save")}
            </button>
            <button
              type="button"
              onClick={close}
              disabled={busy}
              className="text-[11.5px] text-[var(--text-faint)] underline underline-offset-2"
            >
              {tr("agency.outcome.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
