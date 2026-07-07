import type { DashboardData } from "@/lib/types";
import { SectionCard } from "../SectionCard";
import { PmcChart } from "../PmcChart";

export function FitnessBlock({ data }: { data: DashboardData }) {
  return (
    <SectionCard title="Fitness & Freshness" subtitle="Fitness, fatigue & form over time — tap a metric to toggle it">
      <PmcChart data={data.trainingLoad} />
    </SectionCard>
  );
}
