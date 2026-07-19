import type { DashboardData } from "@/lib/types";
import { DEFAULT_LOCALE, translator, type Locale } from "@/lib/i18n";
import { SectionCard } from "../SectionCard";
import { CalendarBoard } from "../CalendarBoard";

export function CalendarBlock({
  data,
  todayISO,
  locale = DEFAULT_LOCALE,
}: {
  data: DashboardData;
  todayISO: string;
  locale?: Locale;
}) {
  const tr = translator(locale);
  return (
    <SectionCard title={tr("block.calendar")} subtitle={tr("block.calendar.sub")}>
      {/* FTP is needed to turn .zwo power fractions into real watts */}
      <CalendarBoard
        workouts={data.workouts}
        todayISO={todayISO}
        locale={locale}
        ftpWatts={data.indicators?.ftp_watts ?? null}
      />
    </SectionCard>
  );
}
