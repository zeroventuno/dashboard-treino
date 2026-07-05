import type { DashboardData } from "@/lib/types";
import { SectionCard } from "../SectionCard";
import { PmcChart } from "../PmcChart";

export function FitnessBlock({ data }: { data: DashboardData }) {
  return (
    <SectionCard title="Fitness & Freshness" subtitle="Training load over the last 24 weeks — tap a metric to toggle it">
      <PmcChart data={data.trainingLoad} />
    </SectionCard>
  );
}
