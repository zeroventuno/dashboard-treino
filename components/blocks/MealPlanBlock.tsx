import type { DashboardData } from "@/lib/types";
import { DEFAULT_LOCALE, translator, type Locale } from "@/lib/i18n";
import { SectionCard } from "../SectionCard";
import { MealPlan } from "../MealPlan";

export function MealPlanBlock({ data, locale = DEFAULT_LOCALE }: { data: DashboardData;
  locale?: Locale;
}) {
  const tr = translator(locale);
  return (
    <SectionCard title={tr("block.mealplan")} subtitle={tr("block.mealplan.sub")}>
      <MealPlan meals={data.mealPlan} rules={data.nutritionRules} />
    </SectionCard>
  );
}
