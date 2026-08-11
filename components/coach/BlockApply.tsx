"use client";

// Applying a multi-week block to a cohort.
//
// Three steps, and the middle one is the point: pick the block and who gets it,
// SEE where every session lands for every athlete, then commit. The preview is
// not a courtesy — a template written for eight hours meets an athlete with
// five and something has to give, and the coach is the only one who can say
// what. Writing first and letting them fix it afterwards would mean editing
// thirty calendars by hand, which is the work this feature exists to remove.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { translator, type Locale } from "@/lib/i18n";
import { fmtDayMonth } from "@/lib/utils";
import type { PlanBlockRow, BlockPreview, RosterAthlete } from "@/lib/product-db";
import { disciplineMeta } from "@/lib/utils";

/** Monday of the coming week — a block starts on a Monday, and starting one
 * mid-week would push every "week 1" boundary out of step with the calendar. */
function nextMondayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function BlockApply({
  blocks,
  roster,
  locale,
}: {
  blocks: PlanBlockRow[];
  roster: RosterAthlete[];
  locale: Locale;
}) {
  const tr = translator(locale);
  const router = useRouter();

  const [blockId, setBlockId] = useState<string>(blocks[0]?.id ?? "");
  const [startISO, setStartISO] = useState(nextMondayISO());
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [previews, setPreviews] = useState<BlockPreview[] | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "saving" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const block = blocks.find((b) => b.id === blockId);

  // Grouped by phase, like the roster: the cohort IS the unit being prescribed
  // to, so selecting one should be one click, not thirty.
  const byPhase = new Map<string, RosterAthlete[]>();
  for (const a of roster) {
    const key = a.current_phase ?? "";
    byPhase.set(key, [...(byPhase.get(key) ?? []), a]);
  }

  function toggle(id: string) {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
    setPreviews(null); // the preview describes a selection that no longer exists
  }

  function togglePhase(list: RosterAthlete[]) {
    const all = list.every((a) => chosen.has(a.tenant_id));
    const next = new Set(chosen);
    for (const a of list) {
      if (all) next.delete(a.tenant_id);
      else next.add(a.tenant_id);
    }
    setChosen(next);
    setPreviews(null);
  }

  async function preview() {
    setState("loading");
    setMessage("");
    try {
      const res = await fetch("/api/coach/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", blockId, tenantIds: [...chosen], startISO }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? String(res.status));
      setPreviews(json.previews);
      setState("idle");
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : "");
    }
  }

  async function apply() {
    if (!previews) return;
    setState("saving");
    try {
      const res = await fetch("/api/coach/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply", previews }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? String(res.status));
      setState("done");
      setMessage(tr("blocks.applied").replace("{n}", String(json.written)).replace("{a}", String(json.athletes)));
      setPreviews(null);
      setChosen(new Set());
      router.refresh();
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : "");
    }
  }

  if (blocks.length === 0) {
    return (
      <p className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] px-5 py-8 text-center text-[13.5px] text-[var(--text-faint)]">
        {tr("blocks.empty")}
      </p>
    );
  }

  const totalUnplaced = previews?.reduce((n, p) => n + p.unplaced.length, 0) ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {/* which block, starting when */}
      <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
            {tr("blocks.block")}
          </span>
          <select
            value={blockId}
            onChange={(e) => { setBlockId(e.target.value); setPreviews(null); }}
            className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-[13px] text-[var(--text)] outline-none"
          >
            {blocks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} · {b.weeks.length} {tr("blocks.weeks")}
                {b.phase ? ` · ${b.phase}` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
            {tr("blocks.start")}
          </span>
          <input
            type="date"
            value={startISO}
            onChange={(e) => { setStartISO(e.target.value); setPreviews(null); }}
            className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-[13px] text-[var(--text)] outline-none"
          />
        </label>

        <button
          onClick={preview}
          disabled={chosen.size === 0 || state === "loading"}
          className="rounded-full bg-[var(--lime)] px-5 py-2 text-[13px] font-bold text-[#0a0b0d] disabled:opacity-40"
        >
          {state === "loading" ? tr("blocks.previewing") : tr("blocks.preview")}
        </button>
      </div>

      {block?.notes && <p className="px-1 text-[12.5px] text-[var(--text-muted)]">{block.notes}</p>}

      {/* the cohort */}
      <div className="flex flex-col gap-3">
        {[...byPhase.entries()].map(([phase, list]) => (
          <div key={phase || "none"}>
            <button
              onClick={() => togglePhase(list)}
              className="mb-1.5 flex items-baseline gap-2 px-1 text-[12.5px] font-bold uppercase tracking-wide text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              {phase || tr("coach.noPhase")}
              <span className="tnum text-[11.5px] font-normal text-[var(--text-faint)]">{list.length}</span>
            </button>
            <div className="flex flex-wrap gap-1.5">
              {list.map((a) => {
                const on = chosen.has(a.tenant_id);
                return (
                  <button
                    key={a.tenant_id}
                    onClick={() => toggle(a.tenant_id)}
                    className="rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors"
                    style={{
                      borderColor: on ? "var(--lime)" : "var(--border)",
                      background: on ? "var(--lime)" : "transparent",
                      color: on ? "#0a0b0d" : "var(--text-muted)",
                    }}
                  >
                    {a.athlete ?? a.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* the preview — the whole reason this is two steps */}
      {previews && previews.length > 0 && (
        <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] font-bold text-[var(--text)]">
              {tr("blocks.previewTitle").replace("{n}", String(previews.length))}
            </p>
            <button
              onClick={apply}
              disabled={state === "saving"}
              className="rounded-full bg-[var(--lime)] px-5 py-2 text-[13px] font-bold text-[#0a0b0d] disabled:opacity-40"
            >
              {state === "saving" ? tr("blocks.applying") : tr("blocks.apply")}
            </button>
          </div>

          {/* Named, not hidden. This is the number the coach has to look at. */}
          {totalUnplaced > 0 && (
            <p
              className="rounded-[8px] px-3 py-2 text-[12.5px]"
              style={{ color: "var(--warn)", background: "color-mix(in oklab, var(--warn) 12%, transparent)" }}
            >
              {tr("blocks.unplaced").replace("{n}", String(totalUnplaced))}
            </p>
          )}

          <div className="flex flex-col gap-3">
            {previews.map((p) => (
              <div key={p.tenantId} className="rounded-[12px] border border-[var(--border-soft)] bg-[var(--bg-soft)] p-3">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <p className="text-[13px] font-bold text-[var(--text)]">{p.name}</p>
                  <p className="tnum text-[11.5px] text-[var(--text-faint)]">
                    {p.days.length} {tr("blocks.sessions")}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1">
                  {p.days.map((d, i) => (
                    <span
                      key={i}
                      className="rounded-[6px] px-1.5 py-[3px] text-[10.5px] font-medium"
                      style={{
                        color: disciplineMeta(d.session.discipline).color,
                        background: `color-mix(in oklab, ${disciplineMeta(d.session.discipline).color} 12%, transparent)`,
                      }}
                      title={`${d.session.title} · ${d.session.duration_min}min`}
                    >
                      {fmtDayMonth(d.dateISO)} · {d.session.duration_min}′
                    </span>
                  ))}
                </div>

                {p.unplaced.length > 0 && (
                  <p className="mt-2 text-[11.5px]" style={{ color: "var(--warn)" }}>
                    {tr("blocks.didNotFit")}:{" "}
                    {p.unplaced.map((u) => `${tr("blocks.week")} ${u.week} · ${u.session.title}`).join(" · ")}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {state === "done" && <p className="px-1 text-[13px] font-semibold text-[var(--good)]">{message}</p>}
      {state === "error" && (
        <p className="px-1 text-[13px] text-[var(--bad)]">
          {tr("admin.saveError")} {message}
        </p>
      )}
    </div>
  );
}
