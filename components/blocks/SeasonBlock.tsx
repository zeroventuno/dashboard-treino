import type { DashboardData } from "@/lib/types";
import { SectionCard } from "../SectionCard";
import { SeasonBars } from "../SeasonBars";

export function SeasonBlock({ data, todayISO }: { data: DashboardData; todayISO: string }) {
  return (
    <SectionCard title="Season" subtitle="Weekly training volume by phase, base to race day">
      <SeasonBars phases={data.phases} trainingLoad={data.trainingLoad} milestones={data.milestones} todayISO={todayISO} />
    </SectionCard>
  );
}
