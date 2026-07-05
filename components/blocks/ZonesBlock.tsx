import type { DashboardData } from "@/lib/types";
import { SectionCard } from "../SectionCard";
import { PerformanceZones } from "../PerformanceIndicators";

export function ZonesBlock({ data }: { data: DashboardData }) {
  return (
    <SectionCard title="Performance Zones" subtitle="Bike power · run pace · swim & heart-rate zones">
      <PerformanceZones ind={data.indicators} />
    </SectionCard>
  );
}
