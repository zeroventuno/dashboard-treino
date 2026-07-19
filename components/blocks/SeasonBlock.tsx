import type { DashboardData } from "@/lib/types";
import { DEFAULT_LOCALE, translator, type Locale } from "@/lib/i18n";
import { SectionCard } from "../SectionCard";
import { SeasonBars } from "../SeasonBars";

export function SeasonBlock({ data, todayISO, locale = DEFAULT_LOCALE }: { data: DashboardData; todayISO: string;
  locale?: Locale;
}) {
  const tr = translator(locale);
  return (
    <SectionCard title={tr("block.season")} subtitle={tr("block.season.sub")}>
      <SeasonBars phases={data.phases} trainingLoad={data.trainingLoad} milestones={data.milestones} todayISO={todayISO} />
    </SectionCard>
  );
}
