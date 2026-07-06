import type { DashboardData } from "@/lib/types";
import { SectionCard } from "../SectionCard";
import { MealPlan } from "../MealPlan";

export function MealPlanBlock({ data }: { data: DashboardData }) {
  return (
    <SectionCard title="Plano Alimentar Diário" subtitle="Refeições de referência + regras de nutrição por duração de treino">
      <MealPlan meals={data.mealPlan} rules={data.nutritionRules} />
    </SectionCard>
  );
}
