"use client";

// "Enviar para a COROS" — the preview the athlete approves before anything
// lands on their watch.
//
// Nothing is ticked by default and nothing is sent on a timer: a workout put
// on a COROS schedule can only be removed by hand in the COROS app, so every
// send is an explicit act on a list the athlete has seen. Each row says what
// will actually be sent — how many steps, and how many of them carry a real
// target versus only text.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { translator, type Locale, type TKey } from "@/lib/i18n";

export interface PushCandidate {
  id: string;
  date: string;
  title: string;
  discipline: "run" | "bike";
  /** Sendable at all (sport, window, duration). */
  ok: boolean;
  reason?: string;
  steps: number;
  textOnly: number;
  /** new: never sent · sent: on COROS as is · changed: sent, edited since ·
   * moved: sent, but the session changed day (the old copy is still there). */
  state: "new" | "sent" | "changed" | "moved";
}

const STATE_COLOR: Record<PushCandidate["state"], string> = {
  new: "var(--text-faint)",
  sent: "var(--good)",
  changed: "var(--warn)",
  moved: "var(--bad)",
};

export function CorosPush({ candidates, locale }: { candidates: PushCandidate[]; locale: Locale }) {
  const tr = translator(locale);
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // Only what a send can act on: new, or edited since it was sent.
  const actionable = candidates.filter((c) => c.ok && (c.state === "new" || c.state === "changed"));

  function toggle(id: string) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function send() {
    if (!picked.size || busy) return;
    if (!confirm(tr("coros.push.confirm"))) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/app/coros/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutIds: [...picked] }),
      });
      const json = await res.json().catch(() => ({}));
      const list: { status: string; detail?: string }[] = Array.isArray(json.results) ? json.results : [];
      const count = (s: string) => list.filter((r) => r.status === s).length;
      const parts = [
        count("created") && `${count("created")} ${tr("coros.push.created")}`,
        count("updated") && `${count("updated")} ${tr("coros.push.updated")}`,
        count("date_changed") && `${count("date_changed")} ${tr("coros.push.moved")}`,
        count("not_editable") && `${count("not_editable")} ${tr("coros.push.notEditable")}`,
        count("failed") && `${count("failed")} ${tr("coros.push.failed")}`,
      ].filter(Boolean);
      const firstError = list.find((r) => r.status === "failed")?.detail;
      setResult(
        !res.ok && !list.length
          ? `${tr("device.failed")} ${json.code === "needs_migration" ? tr("coros.unavailable") : (json.error ?? json.code ?? res.status)}`
          : parts.join(" · ") + (firstError ? ` — ${firstError}` : ""),
      );
      setPicked(new Set());
      router.refresh();
    } catch {
      setResult(tr("device.error"));
    } finally {
      setBusy(false);
    }
  }

  const fmtDate = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "short" });

  return (
    <details className="w-full">
      <summary className="cursor-pointer text-[11.5px] font-semibold text-[var(--text-muted)]">
        {tr("coros.push.title")}
      </summary>
      <p className="mt-1.5 text-[10.5px] text-[var(--text-faint)]">{tr("coros.push.hint")}</p>

      {candidates.length === 0 ? (
        <p className="mt-2 text-[11.5px] text-[var(--text-faint)]">{tr("coros.push.none")}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {candidates.map((c) => {
            const canPick = c.ok && (c.state === "new" || c.state === "changed");
            return (
              <li key={c.id} className="flex items-start gap-2 text-[11.5px]">
                <input
                  type="checkbox"
                  className="mt-[3px]"
                  disabled={!canPick || busy}
                  checked={picked.has(c.id)}
                  onChange={() => toggle(c.id)}
                  aria-label={c.title}
                />
                <span className="min-w-0 flex-1">
                  <span className="text-[var(--text)]">{fmtDate(c.date)} · {c.title}</span>
                  <span className="block text-[10.5px] text-[var(--text-faint)]">
                    {c.ok
                      ? `${c.steps} ${tr("coros.push.steps")}` +
                        (c.textOnly ? ` · ${c.textOnly} ${tr("coros.push.textOnly")}` : "")
                      : tr(`coros.push.reason.${c.reason ?? "unsupported_sport"}` as TKey)}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] font-bold uppercase" style={{ color: STATE_COLOR[c.state] }}>
                  {tr(`coros.push.state.${c.state}` as TKey)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {actionable.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPicked(new Set(actionable.map((c) => c.id)))}
            disabled={busy}
            className="text-[11px] text-[var(--text-faint)] underline underline-offset-2"
          >
            {tr("coros.push.selectAll")}
          </button>
          <button
            type="button"
            onClick={send}
            disabled={busy || picked.size === 0}
            className="rounded-full bg-[var(--lime)] px-3.5 py-[5px] text-[11.5px] font-bold text-[#0a0b0d] disabled:opacity-40"
          >
            {busy ? tr("coros.push.sending") : `${tr("coros.push.send")} (${picked.size})`}
          </button>
        </div>
      )}

      {result && <p className="mt-2 break-words text-[11.5px] text-[var(--text-muted)]">{result}</p>}
    </details>
  );
}
