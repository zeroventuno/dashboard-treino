import type { DashboardData } from "@/lib/types";
import { DEFAULT_LOCALE, translator, type Locale } from "@/lib/i18n";
import { SectionCard } from "../SectionCard";
import { MenstrualCycleView } from "../MenstrualCycle";

export function MenstrualCycleBlock({
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
    <SectionCard title={tr("block.menstrual")} subtitle={tr("block.menstrual.sub")}>
      <MenstrualCycleView cycle={data.menstrualCycle} todayISO={todayISO} locale={locale} />
    </SectionCard>
  );
}
