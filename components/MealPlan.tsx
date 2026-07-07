"use client";

import { useState } from "react";
import type { DailyMeal, NutritionRule } from "@/lib/types";

const CATEGORY_LABEL: Record<string, string> = {
  curto: "Curto", medio: "Médio", longo: "Longo", muito_longo: "Muito longo",
};

/** Collapsed-by-default section: header row is always visible (title + summary
 * chips + chevron); the body slides open on click so nutrition reference stays
 * out of the way of the training content. */
function CollapseSection({
  title, summary, defaultOpen = false, children,
}: {
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)]">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-3.5 text-left transition-colors hover:bg-[var(--surface-3)] rounded-[var(--radius-sm)]"
      >
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-[var(--text)]">{title}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-[var(--text-faint)]">{summary}</p>
        </div>
        <span
          className="shrink-0 text-[var(--text-faint)] transition-transform duration-300"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        >
          ▾
        </span>
      </button>
      <div className={`collapse-grid ${open ? "open" : ""}`}>
        <div>
          <div className="px-3.5 pb-3.5">{children}</div>
        </div>
      </div>
    </div>
  );
}

function MealRow({ meal }: { meal: DailyMeal }) {
  return (
    <div className="flex gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="w-14 shrink-0 text-right">
        <span className="tnum text-[12px] font-semibold text-[var(--text-muted)]">{meal.time_suggestion ?? "—"}</span>
      </div>
      <div className="min-w-0 flex-1 border-l border-[var(--border)] pl-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[13.5px] font-semibold text-[var(--text)]">{meal.meal_name}</p>
          {(meal.protein_g != null || meal.carbs_g != null) && (
            <span className="tnum shrink-0 rounded-full border border-[var(--border)] bg-[var(--surface-3)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-muted)]">
              {meal.protein_g != null ? `P ${meal.protein_g}g` : ""}
              {meal.protein_g != null && meal.carbs_g != null ? " · " : ""}
              {meal.carbs_g != null ? `C ${meal.carbs_g}g` : ""}
            </span>
          )}
        </div>
        {meal.foods && (
          <p className="mt-1 whitespace-pre-line text-[12.5px] leading-relaxed text-[var(--text-muted)]">{meal.foods}</p>
        )}
        {meal.notes && <p className="mt-1 text-[11px] italic text-[var(--text-faint)]">{meal.notes}</p>}
      </div>
    </div>
  );
}

function RuleCard({ rule }: { rule: NutritionRule }) {
  const label = CATEGORY_LABEL[rule.duration_category] ?? rule.duration_category;
  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-bold text-[var(--text)]">{label}</span>
        <span className="tnum text-[11px] text-[var(--lime)]">{rule.duration_range}</span>
      </div>
      {rule.discipline_context && (
        <p className="mt-0.5 text-[10.5px] text-[var(--text-faint)]">{rule.discipline_context}</p>
      )}
      <div className="mt-2 space-y-1.5">
        <RuleLine label="Antes" text={rule.before_training} />
        <RuleLine label="Durante" text={rule.during_training} />
        <RuleLine label="Depois" text={rule.after_training} />
      </div>
      {rule.supplements_used && rule.supplements_used.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {rule.supplements_used.map((s) => (
            <span key={s} className="rounded-full border border-[var(--border)] bg-[var(--surface-3)] px-1.5 py-0.5 text-[9.5px] text-[var(--text-faint)]">
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function RuleLine({ label, text }: { label: string; text: string | null }) {
  if (!text) return null;
  return (
    <div className="text-[11.5px] leading-snug">
      <span className="font-semibold text-[var(--text-muted)]">{label}: </span>
      <span className="text-[var(--text-faint)]">{text}</span>
    </div>
  );
}

export function MealPlan({ meals, rules }: { meals: DailyMeal[]; rules: NutritionRule[] }) {
  if (meals.length === 0 && rules.length === 0) {
    return <p className="text-[13px] text-[var(--text-faint)]">No meal plan set yet — ask the coach in chat to build one.</p>;
  }

  const totalP = meals.reduce((s, m) => s + (m.protein_g ?? 0), 0);
  const totalC = meals.reduce((s, m) => s + (m.carbs_g ?? 0), 0);

  return (
    <div className="space-y-2.5">
      {meals.length > 0 && (
        <CollapseSection
          title="Refeições do dia"
          summary={`${meals.length} refeições · ~${Math.round(totalP)}g proteína · ~${Math.round(totalC)}g carbo`}
        >
          <div className="space-y-2">
            {[...meals].sort((a, b) => a.meal_order - b.meal_order).map((m) => (
              <MealRow key={m.id} meal={m} />
            ))}
          </div>
        </CollapseSection>
      )}

      {rules.length > 0 && (
        <CollapseSection
          title="Nutrição pré / durante / pós treino"
          summary={`${rules.length} regras por duração de treino`}
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {rules.map((r) => <RuleCard key={r.id} rule={r} />)}
          </div>
        </CollapseSection>
      )}
    </div>
  );
}
