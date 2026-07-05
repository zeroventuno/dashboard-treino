import type { DashboardData } from "@/lib/types";
import { SectionCard } from "../SectionCard";
import { InjuryTracker } from "../InjuryTracker";

export function WatchPointsBlock({ data }: { data: DashboardData }) {
  return (
    <SectionCard title="Watch Points" subtitle="Injury log · latest entries">
      <InjuryTracker injuries={data.injuries} />
    </SectionCard>
  );
}
