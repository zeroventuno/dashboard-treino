import type { DashboardData } from "@/lib/types";
import { SectionCard } from "../SectionCard";
import { CalendarBoard } from "../CalendarBoard";

export function CalendarBlock({ data, todayISO }: { data: DashboardData; todayISO: string }) {
  return (
    <SectionCard title="Training Calendar" subtitle="Click a workout for details · weekly totals on the right">
      <CalendarBoard workouts={data.workouts} todayISO={todayISO} />
    </SectionCard>
  );
}
