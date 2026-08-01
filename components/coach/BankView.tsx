"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { translator, type Locale } from "@/lib/i18n";
import type { BankWorkout } from "@/lib/product-db";

const SPORTS = ["swim", "bike", "run", "strength"] as const;
const SPORT_LABEL: Record<string, string> = { swim: "Natação", bike: "Bike", run: "Corrida", strength: "Força" };

export function BankView({ items, locale }: { items: BankWorkout[]; locale: Locale }) {
  const tr = translator(locale);
  const router = useRouter();
  const [sel, setSel] = useState<string[]>([...SPORTS]);
  const [perPhase, setPerPhase] = useState(3);
  const [gen, setGen] = useState<"idle" | "busy" | "sent" | "off" | "error">("idle");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function generate() {
    if (sel.length === 0) return;
    setGen("busy");
    try {
      const res = await fetch("/api/coach/bank/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sports: sel, perPhase }),
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

  // Group by sport for the list.
  const bySport = new Map<string, BankWorkout[]>();
  for (const w of items) (bySport.get(w.sport) ?? bySport.set(w.sport, []).get(w.sport)!).push(w);

  return (
    <div className="flex flex-col gap-6">
      {/* Generate */}
      <section className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] p-5">
        <h2 className="text-[14px] font-bold text-[var(--text)]">{tr("coach.bank.generate")}</h2>
        <p className="mt-0.5 text-[12.5px] text-[var(--text-faint)]">{tr("coach.bank.generateHint")}</p>

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
          <button
            type="button"
            onClick={generate}
            disabled={gen === "busy" || sel.length === 0}
            className="rounded-[10px] bg-[var(--lime)] px-4 py-2 text-[13px] font-bold text-[#0a0b0d] transition-opacity disabled:opacity-40"
          >
            {gen === "busy" ? "…" : tr("coach.bank.generate")}
          </button>
        </div>

        {gen === "sent" && <p className="mt-2.5 text-[12px] text-[var(--good)]">{tr("coach.bank.generating")}</p>}
        {gen === "off" && <p className="mt-2.5 text-[12px] text-[var(--warn)]">{tr("coach.bank.genOff")}</p>}
        {gen === "error" && <p className="mt-2.5 text-[12px] text-[var(--bad)]">{tr("coach.bank.genError")}</p>}
      </section>

      {/* Library */}
      {items.length === 0 ? (
        <p className="rounded-[var(--radius)] border border-[var(--border-soft)] bg-[var(--surface)] px-5 py-8 text-center text-[13.5px] text-[var(--text-faint)]">
          {tr("coach.bank.empty")}
        </p>
      ) : (
        [...bySport.entries()].map(([sport, list]) => (
          <section key={sport}>
            <h3 className="mb-2 px-1 text-[13px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
              {SPORT_LABEL[sport] ?? sport} <span className="tnum text-[var(--text-faint)]">{list.length}</span>
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {list.map((w) => {
                const validated = w.status === "validated";
                return (
                  <div key={w.id} className="rounded-[12px] border border-[var(--border-soft)] bg-[var(--surface)] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-semibold text-[var(--text)]">{w.title}</p>
                        <p className="mt-0.5 text-[11.5px] text-[var(--text-faint)]">
                          {[w.phase, w.duration_min ? `${w.duration_min}min` : null, w.tss ? `TSS ${w.tss}` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
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
          </section>
        ))
      )}
    </div>
  );
}
