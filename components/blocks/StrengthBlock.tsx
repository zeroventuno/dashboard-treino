import type { DashboardData } from "@/lib/types";
import { SectionCard } from "../SectionCard";
import { BodyMap } from "../BodyMap";

export function StrengthBlock({ data }: { data: DashboardData }) {
  return (
    <SectionCard title="Strength · Muscle Use" subtitle="Sessions in the last 7 days">
      <BodyMap sessions={data.strength} />
    </SectionCard>
  );
}
