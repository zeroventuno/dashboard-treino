import type { DashboardData } from "@/lib/types";
import { SectionCard } from "../SectionCard";
import { MealPlan } from "../MealPlan";

export function MealPlanBlock({ data }: { data: DashboardData }) {
  return (
    <SectionCard title="Plano Alimentar Diário" subtitle="Referência de refeições e nutrição de treino — clique numa seção para abrir">
      <MealPlan meals={data.mealPlan} rules={data.nutritionRules} />
    </SectionCard>
  );
}
