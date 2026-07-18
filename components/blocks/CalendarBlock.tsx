import type { DashboardData } from "@/lib/types";
import { SectionCard } from "../SectionCard";
import { CalendarBoard } from "../CalendarBoard";

export function CalendarBlock({ data, todayISO }: { data: DashboardData; todayISO: string }) {
  return (
    <SectionCard title="Training Calendar" subtitle="Click a workout for details · weekly totals on the right">
      {/* FTP is needed to turn .zwo power fractions into real watts */}
      <CalendarBoard
        workouts={data.workouts}
        todayISO={todayISO}
        ftpWatts={data.indicators?.ftp_watts ?? null}
      />
    </SectionCard>
  );
}
