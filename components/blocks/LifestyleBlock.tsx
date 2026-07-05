import type { DashboardData } from "@/lib/types";
import { SectionCard } from "../SectionCard";
import { LifestyleGoals } from "../LifestyleGoals";

export function LifestyleBlock({ data }: { data: DashboardData }) {
  return (
    <SectionCard title="Lifestyle · 7-day avg" subtitle="Logged via daily check-ins in chat">
      <LifestyleGoals checkins={data.checkins} />
    </SectionCard>
  );
}
