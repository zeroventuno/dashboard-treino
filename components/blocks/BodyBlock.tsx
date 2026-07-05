import type { DashboardData } from "@/lib/types";
import { SectionCard } from "../SectionCard";
import { BodyCompositionChart } from "../BodyCompositionChart";

export function BodyBlock({ data }: { data: DashboardData }) {
  return (
    <SectionCard title="Body Composition" subtitle="Bioimpedance trends — tap a metric to chart it">
      <BodyCompositionChart entries={data.bodyComposition} />
    </SectionCard>
  );
}
