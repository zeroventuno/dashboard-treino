import type { DashboardData } from "@/lib/types";
import { DEFAULT_LOCALE, translator, type Locale } from "@/lib/i18n";
import type { Units } from "@/lib/utils";
import { SectionCard } from "../SectionCard";
import { CalendarBoard } from "../CalendarBoard";

export function CalendarBlock({
  data,
  todayISO,
  locale = DEFAULT_LOCALE,
  units = "metric",
  editable = false,
}: {
  data: DashboardData;
  todayISO: string;
  locale?: Locale;
  units?: Units;
  /** Athlete viewing their own dashboard → sessions can be dragged to another day. */
  editable?: boolean;
}) {
  const tr = translator(locale);
  return (
    <SectionCard title={tr("block.calendar")} subtitle={tr("block.calendar.sub")}>
      {/* FTP is needed to turn .zwo power fractions into real watts */}
      <CalendarBoard
        workouts={data.workouts}
        todayISO={todayISO}
        locale={locale}
        units={units}
        ftpWatts={data.indicators?.ftp_watts ?? null}
        editable={editable}
      />
    </SectionCard>
  );
}
