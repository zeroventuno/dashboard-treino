"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { translator, type Locale } from "@/lib/i18n";
import type { BankWorkout, Methodology } from "@/lib/product-db";
import type { Workout, Discipline, WorkoutBlock } from "@/lib/types";
import { WorkoutModal } from "@/components/WorkoutModal";

const SPORTS = ["swim", "bike", "run", "strength"] as const;
const SPORT_LABEL: Record<string, string> = { swim: "Natação", bike: "Bike", run: "Corrida", strength: "Força" };
// Canonical cycle phases — same strings the season, set_cycle and the bank use.
const PHASES = ["Base", "Build", "Peak", "Taper"] as const;
const METHOD_FIELDS = ["philosophy", "periodization", "intensity_distribution", "defaults", "notes"] as const;
/** Bucket for library items the AI (or an import) left without a phase. */
const NO_PHASE = "—";
/** Same colours the athlete's season timeline paints these phases with, so a
 * phase reads the same wherever it appears in the product. */
const PHASE_COLOR: Record<string, string> = {
  Base: "#2dd4bf",
  Build: "#c6f24e",
  Peak: "#f4a24e",
  Taper: "#4fb8ff",
  [NO_PHASE]: "var(--text-faint)",
};

/** A library item rendered through the athlete's own workout modal: the coach
 * reviews exactly what the athlete will see — block list, profile chart, and the
 * .zwo/.fit the dashboard derives from those blocks. A bank item has no date or
 * result, so those fields are filled with neutral values. */
const blockCount = (b: BankWorkout) => (Array.isArray(b.structure) ? b.structure.length : 0);

function asWorkout(b: BankWorkout): Workout {
  return {
    id: b.id,
    date: "",
    discipline: b.sport as Discipline,
    title: b.title,
    description: b.description,
    garmin_instructions: null,
    zwo_content: null,
    status: "planned",
    planned_duration_min: b.duration_min,
    actual_duration_min: null,
    planned_distance_km: null,
    actual_distance_km: null,
    planned_tss: b.tss,
    actual_tss: null,
    notes: null,
    nutrition_notes: null,
    structure: (Array.isArray(b.structure) ? b.structure : null) as WorkoutBlock[] | null,
  };
}

export function BankView({
  items,
  methodology,
  locale,
}: {
  items: BankWorkout[];
  methodology: Methodology;
  locale: Locale;
}) {
  const tr = translator(locale);
  const router = useRouter();
  const [sel, setSel] = useState<string[]>([...SPORTS]);
  const [phaseSel, setPhaseSel] = useState<string[]>([...PHASES]);
  const [perPhase, setPerPhase] = useState(3);
  const [gen, setGen] = useState<"idle" | "busy" | "sent" | "off" | "error">("idle");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Tag filter narrows the library (AND: a workout must carry every picked tag).
  // This is what keeps a 500-workout bank browsable.
  const [tagSel, setTagSel] = useState<string[]>([]);
  // Library filters (empty array = no narrowing, which reads better than
  // "everything selected" once a filter has more values than fit on a line).
  const [sportFilter, setSportFilter] = useState<string[]>([]);
  const [phaseFilter, setPhaseFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "validated">("all");
  const [open, setOpen] = useState<BankWorkout | null>(null);
  // Methodology is what the leader agent reads before briefing the specialists,
  // so it belongs next to the button that starts them.
  const [method, setMethod] = useState<Record<string, string>>(() =>
    Object.fromEntries(METHOD_FIELDS.map((f) => [f, typeof methodology[f] === "string" ? (methodology[f] as string) : ""])),
  );
  const [methodOpen, setMethodOpen] = useState(false);
  const [methodState, setMethodState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function saveMethodology() {
    setMethodState("saving");
    try {
      const res = await fetch("/api/coach/methodology", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(method),
      });
      setMethodState(res.ok ? "saved" : "error");
      if (res.ok) setTimeout(() => setMethodState("idle"), 2000);
    } catch {
      setMethodState("error");
    }
  }

  async function generate() {
    if (sel.length === 0 || phaseSel.length === 0) return;
    setGen("busy");
    try {
      const res = await fetch("/api/coach/bank/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sports: sel, perPhase, phases: phaseSel }),
      });
      if (res.ok) setGen("sent");
      else setGen((await res.json().catch(() => ({}))).code === "not_configured" ? "off" : "error");
    } catch {
      setGen("error");
    }
  }

  async function setStatus(id: string, status: "validated" | "archived") {
    setBusyId(id);
    await fetch("/api/coach/bank/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    }).catch(() => {});
    setBusyId(null);
    router.refresh();
  }

  // Tag facets come from the data, not a fixed list — a coach's own tags show up
  // beside the suggested vocabulary, and a tag nobody uses never clutters the bar.
  const tagCounts = new Map<string, number>();
  for (const w of items) for (const t of w.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  const allTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const shown = items.filter(
    (w) =>
      (sportFilter.length === 0 || sportFilter.includes(w.sport)) &&
      (phaseFilter.length === 0 || phaseFilter.includes(w.phase ?? NO_PHASE)) &&
      (statusFilter === "all" || w.status === statusFilter) &&
      (tagSel.length === 0 || tagSel.every((t) => (w.tags ?? []).includes(t))),
  );

  // Sport → phase. Generating 3 per phase per sport means a sport section is a
  // wall of near-identical cards unless the phase is a heading you can scan,
  // rather than the third item in a subtitle.
  const bySport = new Map<string, Map<string, BankWorkout[]>>();
  for (const w of shown) {
    const phases = bySport.get(w.sport) ?? bySport.set(w.sport, new Map()).get(w.sport)!;
    const key = w.phase ?? NO_PHASE;
    (phases.get(key) ?? phases.set(key, []).get(key)!).push(w);
  }
  const phaseOrder = (p: string) => {
    const i = (PHASES as readonly string[]).indexOf(p);
    return i === -1 ? PHASES.length : i; // unknown / no phase goes last
  };

  const countFor = (pred: (w: BankWorkout) => boolean) => items.filter(pred).length;

  return (
    <div className="flex flex-col gap-6">
      {/* Generate */}
      <section className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <h2 className="text-[14px] font-bold text-[var(--text)]">{tr("coach.bank.generate")}</h2>
        <p className="mt-0.5 text-[12.5px] text-[var(--text-faint)]">{tr("coach.bank.generateHint")}</p>

        {/* Methodology — read by the leader agent before it briefs the sport
            specialists, so an empty one means generic workouts. */}
        <div className="mt-3 rounded-[12px] border border-[var(--border-soft)] bg-[var(--surface-2)]">
          <button
            type="button"
            onClick={() => setMethodOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left"
          >
            <span className="text-[12.5px] font-semibold text-[var(--text)]">
              {tr("coach.method.title")}{" "}
              <span className="font-normal text-[var(--text-faint)]">
                {METHOD_FIELDS.some((f) => method[f]?.trim()) ? "" : `· ${tr("coach.method.empty")}`}
              </span>
            </span>
            <span className="text-[var(--text-faint)]">{methodOpen ? "−" : "+"}</span>
          </button>

          {methodOpen && (
            <div className="space-y-2.5 border-t border-[var(--border-soft)] p-3.5">
              <p className="text-[11.5px] leading-relaxed text-[var(--text-faint)]">{tr("coach.method.hint")}</p>
              {METHOD_FIELDS.map((f) => (
                <label key={f} className="block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
                    {tr(`coach.method.${f}` as Parameters<typeof tr>[0])}
                  </span>
                  <textarea
                    value={method[f] ?? ""}
                    onChange={(e) => setMethod((m) => ({ ...m, [f]: e.target.value }))}
                    rows={f === "philosophy" || f === "defaults" || f === "notes" ? 3 : 1}
                    className="w-full resize-y rounded-[10px] border border-[var(--border)] bg-[var(--bg-soft)] px-3 py-2 text-[12.5px] text-[var(--text)] outline-none focus:border-[var(--lime)]"
                  />
                </label>
              ))}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveMethodology}
                  disabled={methodState === "saving"}
                  className="rounded-[10px] bg-[var(--lime)] px-4 py-2 text-[12.5px] font-bold text-[#0a0b0d] disabled:opacity-40"
                >
                  {methodState === "saving" ? "…" : tr("coach.method.save")}
                </button>
                {methodState === "saved" && <span className="text-[12px] text-[var(--good)]">{tr("coach.method.saved")}</span>}
                {methodState === "error" && <span className="text-[12px] text-[var(--bad)]">{tr("coach.method.error")}</span>}
              </div>
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {SPORTS.map((s) => {
            const on = sel.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSel((p) => (on ? p.filter((x) => x !== s) : [...p, s]))}
                className="rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors"
                style={{
                  borderColor: on ? "var(--lime)" : "var(--border)",
                  background: on ? "var(--lime)" : "transparent",
                  color: on ? "#0a0b0d" : "var(--text-muted)",
                }}
              >
                {SPORT_LABEL[s]}
              </button>
            );
          })}
          <label className="ml-1 flex items-center gap-1.5 text-[12.5px] text-[var(--text-muted)]">
            <input
              type="number"
              min={1}
              max={20}
              value={perPhase}
              onChange={(e) => setPerPhase(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              className="w-14 rounded-[10px] border border-[var(--border)] bg-[var(--bg-soft)] px-2 py-1.5 text-center tabular-nums text-[var(--text)] outline-none focus:border-[var(--lime)]"
            />
            {tr("coach.bank.perPhase")}
          </label>

          {/* Cycle phases to generate for (defaults to all) */}
          <div className="flex basis-full flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-faint)]">{tr("coach.bank.phases")}</span>
            {PHASES.map((ph) => {
              const on = phaseSel.includes(ph);
              return (
                <button
                  key={ph}
                  type="button"
                  onClick={() => setPhaseSel((p) => (on ? p.filter((x) => x !== ph) : [...p, ph]))}
                  className="rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors"
                  style={{
                    borderColor: on ? "var(--lime)" : "var(--border)",
                    background: on ? "color-mix(in oklab, var(--lime) 16%, transparent)" : "transparent",
                    color: on ? "var(--lime)" : "var(--text-muted)",
                  }}
                >
                  {ph}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={generate}
            disabled={gen === "busy" || sel.length === 0 || phaseSel.length === 0}
            className="rounded-[10px] bg-[var(--lime)] px-4 py-2 text-[13px] font-bold text-[#0a0b0d] transition-opacity disabled:opacity-40"
          >
            {gen === "busy" ? "…" : tr("coach.bank.generate")}
          </button>
        </div>

        {gen === "sent" && <p className="mt-2.5 text-[12px] text-[var(--good)]">{tr("coach.bank.generating")}</p>}
        {gen === "off" && <p className="mt-2.5 text-[12px] text-[var(--warn)]">{tr("coach.bank.genOff")}</p>}
        {gen === "error" && <p className="mt-2.5 text-[12px] text-[var(--bad)]">{tr("coach.bank.genError")}</p>}
      </section>

      {/* ── Library filters ─────────────────────────────────────────────── */}
      {items.length > 0 && (
        <section className="flex flex-col gap-2.5 rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 w-[52px] text-[11px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
              {tr("coach.bank.filterSport")}
            </span>
            {SPORTS.filter((s) => countFor((w) => w.sport === s) > 0).map((s) => {
              const on = sportFilter.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSportFilter((p) => (on ? p.filter((x) => x !== s) : [...p, s]))}
                  className="rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors"
                  style={{
                    borderColor: on ? "var(--lime)" : "var(--border)",
                    background: on ? "color-mix(in oklab, var(--lime) 16%, transparent)" : "transparent",
                    color: on ? "var(--lime)" : "var(--text-muted)",
                  }}
                >
                  {SPORT_LABEL[s] ?? s} <span className="tnum opacity-60">{countFor((w) => w.sport === s)}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 w-[52px] text-[11px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
              {tr("coach.bank.phases")}
            </span>
            {[...PHASES, NO_PHASE].filter((p) => countFor((w) => (w.phase ?? NO_PHASE) === p) > 0).map((p) => {
              const on = phaseFilter.includes(p);
              const color = PHASE_COLOR[p] ?? "var(--text-muted)";
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPhaseFilter((prev) => (on ? prev.filter((x) => x !== p) : [...prev, p]))}
                  className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors"
                  style={{
                    borderColor: on ? color : "var(--border)",
                    background: on ? `color-mix(in oklab, ${color} 16%, transparent)` : "transparent",
                    color: on ? color : "var(--text-muted)",
                  }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                  {p} <span className="tnum opacity-60">{countFor((w) => (w.phase ?? NO_PHASE) === p)}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 w-[52px] text-[11px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
              {tr("coach.bank.filterStatus")}
            </span>
            {(["all", "draft", "validated"] as const).map((st) => {
              const on = statusFilter === st;
              const label =
                st === "all" ? tr("coach.bank.all")
                : st === "draft" ? tr("coach.bank.status.draft")
                : tr("coach.bank.status.validated");
              const n = st === "all" ? items.length : countFor((w) => w.status === st);
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className="rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors"
                  style={{
                    borderColor: on ? "var(--lime)" : "var(--border)",
                    background: on ? "color-mix(in oklab, var(--lime) 16%, transparent)" : "transparent",
                    color: on ? "var(--lime)" : "var(--text-muted)",
                  }}
                >
                  {label} <span className="tnum opacity-60">{n}</span>
                </button>
              );
            })}
            <span className="ml-auto text-[11.5px] text-[var(--text-faint)]">
              {shown.length}/{items.length}
            </span>
          </div>

          {/* Tags stay their own row — the vocabulary grows, the others don't. */}
          {allTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border-soft)] pt-2.5">
              <span className="mr-0.5 w-[52px] text-[11px] font-bold uppercase tracking-wide text-[var(--text-faint)]">
                {tr("coach.bank.filterByTag")}
              </span>
          {allTags.map(([tag, n]) => {
            const on = tagSel.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => setTagSel((p) => (on ? p.filter((x) => x !== tag) : [...p, tag]))}
                className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
                style={{
                  borderColor: on ? "var(--lime)" : "var(--border)",
                  background: on ? "color-mix(in oklab, var(--lime) 16%, transparent)" : "transparent",
                  color: on ? "var(--lime)" : "var(--text-muted)",
                }}
              >
                #{tag} <span className="tnum opacity-60">{n}</span>
              </button>
            );
          })}
            </div>
          )}

          {(sportFilter.length > 0 || phaseFilter.length > 0 || statusFilter !== "all" || tagSel.length > 0) && (
            <button
              type="button"
              onClick={() => { setSportFilter([]); setPhaseFilter([]); setStatusFilter("all"); setTagSel([]); }}
              className="self-start text-[11.5px] font-medium text-[var(--text-faint)] underline hover:text-[var(--text-muted)]"
            >
              {tr("coach.bank.clearFilter")}
            </button>
          )}
        </section>
      )}

      {/* Library */}
      {shown.length === 0 ? (
        <p className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] px-5 py-8 text-center text-[13.5px] text-[var(--text-faint)]">
          {items.length === 0 ? tr("coach.bank.empty") : tr("coach.bank.noMatch")}
        </p>
      ) : (
        [...bySport.entries()].map(([sport, phases]) => {
          const total = [...phases.values()].reduce((n, l) => n + l.length, 0);
          return (
          <section key={sport}>
            <h3 className="mb-2 px-1 text-[13px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
              {SPORT_LABEL[sport] ?? sport} <span className="tnum text-[var(--text-faint)]">{total}</span>
            </h3>
            {[...phases.entries()]
              .sort((a, b) => phaseOrder(a[0]) - phaseOrder(b[0]))
              .map(([phase, list]) => (
              <div key={phase} className="mb-3">
                {/* The phase heading is the separation that was missing: three
                    near-identical bike sessions only differ by the block they
                    belong to. */}
                <div className="mb-1.5 flex items-center gap-2 px-1">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PHASE_COLOR[phase] ?? "var(--text-faint)" }} />
                  <span className="text-[11.5px] font-bold uppercase tracking-wide" style={{ color: PHASE_COLOR[phase] ?? "var(--text-faint)" }}>
                    {phase === NO_PHASE ? tr("coach.bank.noPhase") : phase}
                  </span>
                  <span className="tnum text-[11px] text-[var(--text-faint)]">{list.length}</span>
                  <span className="h-px flex-1 bg-[var(--border-soft)]" />
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {list.map((w) => {
                const validated = w.status === "validated";
                return (
                  <div key={w.id} className="rounded-[12px] border border-[var(--border-soft)] bg-[var(--surface)] p-3">
                    <div className="flex items-start justify-between gap-2">
                      {/* The title opens the same modal the athlete gets — block
                          list, profile chart and the watch files — so the coach
                          validates what they'll actually receive, not a summary. */}
                      <button
                        type="button"
                        onClick={() => setOpen(w)}
                        className="min-w-0 flex-1 text-left"
                        title={tr("coach.bank.openHint")}
                      >
                        <p className="truncate text-[13.5px] font-semibold text-[var(--text)] transition-colors hover:text-[var(--lime)]">
                          {w.title}
                        </p>
                        <p className="mt-0.5 text-[11.5px] text-[var(--text-faint)]">
                          {/* Phase is the group heading now — repeating it here
                              was the noise hiding duration and block count. */}
                          {[
                            w.duration_min ? `${w.duration_min}min` : null,
                            w.tss ? `TSS ${w.tss}` : null,
                            blockCount(w) ? `${blockCount(w)} ${tr("coach.bank.blocks")}` : tr("coach.bank.noBlocks"),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </button>
                      <span
                        className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase"
                        style={{
                          borderColor: validated ? "var(--good)" : "var(--warn)",
                          color: validated ? "var(--good)" : "var(--warn)",
                        }}
                      >
                        {validated ? tr("coach.bank.status.validated") : tr("coach.bank.status.draft")}
                      </span>
                    </div>

                    {(w.tags ?? []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(w.tags ?? []).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => setTagSel((p) => (p.includes(t) ? p : [...p, t]))}
                            title={tr("coach.bank.filterByTag")}
                            className="rounded-[6px] bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-faint)] transition-colors hover:text-[var(--lime)]"
                          >
                            #{t}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="mt-2.5 flex gap-1.5">
                      {!validated && (
                        <button
                          type="button"
                          onClick={() => setStatus(w.id, "validated")}
                          disabled={busyId === w.id}
                          className="rounded-[8px] border border-[var(--good)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--good)] disabled:opacity-40"
                        >
                          {tr("coach.bank.validate")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setStatus(w.id, "archived")}
                        disabled={busyId === w.id}
                        className="rounded-[8px] border border-[var(--border)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--text-faint)] hover:text-[var(--text-muted)] disabled:opacity-40"
                      >
                        {tr("coach.bank.archive")}
                      </button>
                    </div>
                  </div>
                );
              })}
                </div>
              </div>
            ))}
          </section>
          );
        })
      )}

      {open && (
        <WorkoutModal
          w={asWorkout(open)}
          locale={locale}
          tags={open.tags}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
